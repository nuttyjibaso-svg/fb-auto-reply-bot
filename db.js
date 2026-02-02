import pg from "pg";
const { Pool } = pg;

let pool;

export async function initDb() {
  if (!process.env.DATABASE_URL) throw new Error("Missing DATABASE_URL");
  pool = new Pool({ connectionString: process.env.DATABASE_URL });

  await pool.query(`
    -- global lock state
    CREATE TABLE IF NOT EXISTS system_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    INSERT INTO system_state (key, value)
    VALUES ('review_lock', 'false')
    ON CONFLICT (key) DO NOTHING;

    -- review batches: only 1 active PENDING_REVIEW at a time
    CREATE TABLE IF NOT EXISTS review_batches (
      batch_id TEXT PRIMARY KEY,
      status TEXT NOT NULL DEFAULT 'PENDING_REVIEW', -- PENDING_REVIEW, APPROVED, REJECTED
      created_at TIMESTAMPTZ DEFAULT NOW(),
      decided_at TIMESTAMPTZ
    );

    -- review items
    CREATE TABLE IF NOT EXISTS review_items (
      id SERIAL PRIMARY KEY,
      batch_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      post_link TEXT,
      comment_id TEXT UNIQUE NOT NULL,
      comment_text TEXT NOT NULL,
      proposed_reply TEXT,
      impact_score INT,
      status TEXT NOT NULL DEFAULT 'PENDING', -- PENDING / REMOVED
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_review_items_batch
    ON review_items(batch_id);

    -- outbox: slow sending queue
    CREATE TABLE IF NOT EXISTS outbox_replies (
      id SERIAL PRIMARY KEY,
      batch_id TEXT NOT NULL,
      post_id TEXT NOT NULL,
      post_link TEXT,
      comment_id TEXT UNIQUE NOT NULL,
      reply_text TEXT NOT NULL,
      scheduled_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED', -- QUEUED, SENT, FAILED, CANCELED
      sent_at TIMESTAMPTZ,
      fail_reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_outbox_due
    ON outbox_replies(status, scheduled_at);
  `);

  console.log("✅ DB ready");
}

function mustPool() {
  if (!pool) throw new Error("DB not initialized");
  return pool;
}

/** system_state */
export async function getState(key) {
  const p = mustPool();
  const r = await p.query(`SELECT value FROM system_state WHERE key=$1`, [key]);
  return r.rows[0]?.value ?? null;
}

export async function setState(key, value) {
  const p = mustPool();
  await p.query(
    `INSERT INTO system_state (key, value) VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`,
    [key, value]
  );
}

/** review_batches */
export async function createNewBatch(batchId) {
  const p = mustPool();
  await p.query(
    `INSERT INTO review_batches (batch_id, status)
     VALUES ($1,'PENDING_REVIEW')
     ON CONFLICT (batch_id) DO NOTHING`,
    [batchId]
  );
}

export async function getPendingBatch() {
  const p = mustPool();
  const r = await p.query(
    `SELECT batch_id, status, created_at
     FROM review_batches
     WHERE status='PENDING_REVIEW'
     ORDER BY created_at DESC
     LIMIT 1`
  );
  return r.rows[0] || null;
}

export async function setBatchStatus(batchId, status) {
  const p = mustPool();
  await p.query(
    `UPDATE review_batches
     SET status=$2, decided_at=NOW()
     WHERE batch_id=$1`,
    [batchId, status]
  );
}

/** review_items */
export async function countItems(batchId) {
  const p = mustPool();
  const r = await p.query(
    `SELECT COUNT(*)::int AS c
     FROM review_items
     WHERE batch_id=$1`,
    [batchId]
  );
  return r.rows[0]?.c ?? 0;
}

export async function insertReviewItem(item) {
  const p = mustPool();
  const {
    batchId,
    postId,
    postLink,
    commentId,
    commentText,
    proposedReply,
    impactScore
  } = item;

  await p.query(
    `INSERT INTO review_items
      (batch_id, post_id, post_link, comment_id, comment_text, proposed_reply, impact_score, status)
     VALUES
      ($1,$2,$3,$4,$5,$6,$7,'PENDING')
     ON CONFLICT (comment_id) DO NOTHING`,
    [
      batchId,
      postId,
      postLink || null,
      commentId,
      commentText,
      proposedReply || null,
      impactScore ?? null
    ]
  );
}

export async function listBatchItems(batchId) {
  const p = mustPool();
  const r = await p.query(
    `SELECT id, post_id, post_link, comment_id, comment_text, proposed_reply, impact_score, status
     FROM review_items
     WHERE batch_id=$1
     ORDER BY post_id, id`,
    [batchId]
  );
  return r.rows;
}

export async function removeReviewItem(batchId, itemId) {
  const p = mustPool();
  await p.query(
    `UPDATE review_items
     SET status='REMOVED'
     WHERE batch_id=$1 AND id=$2`,
    [batchId, itemId]
  );
}

/** outbox */
export async function enqueueApprovedBatch(batchId) {
  const p = mustPool();

  const minDelay = parseInt(process.env.SEND_MIN_DELAY_SEC || "300", 10);
  const maxDelay = parseInt(process.env.SEND_MAX_DELAY_SEC || "420", 10);

  const r = await p.query(
    `SELECT post_id, post_link, comment_id, proposed_reply
     FROM review_items
     WHERE batch_id=$1 AND status='PENDING' AND COALESCE(proposed_reply,'') <> ''
     ORDER BY id ASC`,
    [batchId]
  );

  let offsetSec = 0;

  for (const row of r.rows) {
    // random spacing 5–7 min (or whatever you set)
    offsetSec += Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;

    await p.query(
      `INSERT INTO outbox_replies
        (batch_id, post_id, post_link, comment_id, reply_text, scheduled_at, status)
       VALUES
        ($1,$2,$3,$4,$5, NOW() + ($6 || ' seconds')::interval, 'QUEUED')
       ON CONFLICT (comment_id) DO NOTHING`,
      [batchId, row.post_id, row.post_link, row.comment_id, row.proposed_reply, offsetSec]
    );
  }
}

export async function fetchDueOutboxItem() {
  const p = mustPool();
  const r = await p.query(
    `SELECT id, batch_id, comment_id, reply_text
     FROM outbox_replies
     WHERE status='QUEUED' AND scheduled_at <= NOW()
     ORDER BY scheduled_at ASC
     LIMIT 1`
  );
  return r.rows[0] || null;
}

export async function markOutboxSent(id) {
  const p = mustPool();
  await p.query(
    `UPDATE outbox_replies
     SET status='SENT', sent_at=NOW()
     WHERE id=$1`,
    [id]
  );
}

export async function markOutboxFailed(id, reason) {
  const p = mustPool();
  await p.query(
    `UPDATE outbox_replies
     SET status='FAILED', fail_reason=$2
     WHERE id=$1`,
    [id, reason]
  );
}
import { getState, setState, createNewBatch, getPendingBatch } from "./db.js";
import { nowIso } from "./utils.js";

export async function isLocked() {
  const v = await getState("review_lock");
  return v === "true";
}

export async function lock() {
  await setState("review_lock", "true");
}

export async function unlock() {
  await setState("review_lock", "false");
}

/**
 * Only one pending batch at a time.
 * If there's already a PENDING_REVIEW batch, we reuse it.
 */
export async function getOrCreateBatchId() {
  const pending = await getPendingBatch();
  if (pending?.batch_id) return pending.batch_id;

  const batchId = `batch_${nowIso().replace(/[:.]/g, "-")}`;
  await createNewBatch(batchId);
  return batchId;
}
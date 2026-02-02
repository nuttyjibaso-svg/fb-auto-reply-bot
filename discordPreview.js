import fetch from "node-fetch";
import { listBatchItems } from "./db.js";
import { chunkArray, truncate } from "./utils.js";

function must(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function baseUrl() {
  // MUST set APP_BASE_URL in Railway Variables:
  // https://your-service.up.railway.app
  return (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
}

function makeUrl(path) {
  const b = baseUrl();
  return b ? `${b}${path}` : path; // if missing base, still prints relative
}

export async function sendDiscordPreview(batchId) {
  const webhook = must("DISCORD_WEBHOOK_URL");
  const token = must("ADMIN_APPROVE_TOKEN");

  const items = await listBatchItems(batchId);
  if (!items.length) return;

  const approveUrl = makeUrl(
    `/admin/approve_batch?batch_id=${encodeURIComponent(batchId)}&token=${encodeURIComponent(token)}`
  );
  const rejectUrl = makeUrl(
    `/admin/reject_batch?batch_id=${encodeURIComponent(batchId)}&token=${encodeURIComponent(token)}`
  );

  // Group by post
  const grouped = new Map();
  for (const it of items) {
    if (!grouped.has(it.post_id)) grouped.set(it.post_id, []);
    grouped.get(it.post_id).push(it);
  }

  const content =
    `🧪 FB AUTO-REPLY PREVIEW\n` +
    `Batch: ${batchId}\n` +
    `Total: ${items.length}\n\n` +
    `✅ Approve: ${approveUrl}\n` +
    `❌ Reject: ${rejectUrl}`;

  const embeds = [];

  for (const [postId, arr] of grouped.entries()) {
    const postLink = arr[0]?.post_link || "";
    const title = postLink ? `Post: ${postLink}` : `Post: ${postId}`;

    // build item blocks
    const blocks = arr.map(it => {
      const removeUrl = makeUrl(
        `/admin/remove_item?batch_id=${encodeURIComponent(batchId)}&item_id=${it.id}&token=${encodeURIComponent(token)}`
      );

      const statusMark = it.status === "REMOVED" ? "🗑️ REMOVED" : "🟢 PENDING";
      const impact = it.impact_score ?? "-";
      const reply = it.proposed_reply || "(no proposal)";

      return [
        `#${it.id} ${statusMark} | Impact: ${impact}`,
        `C: ${truncate(it.comment_text, 160)}`,
        `R: ${truncate(reply, 160)}`,
        `Remove: ${removeUrl}`
      ].join("\n");
    });

    // Split into multiple embeds if too big
    const blockChunks = chunkArray(blocks, 8);

    for (let i = 0; i < blockChunks.length; i++) {
      embeds.push({
        title: i === 0 ? title : `${title} (cont.)`,
        description: blockChunks[i].join("\n\n---\n\n")
      });
    }
  }

  await fetch(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, embeds })
  });
}
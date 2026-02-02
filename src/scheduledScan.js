import { isLocked, lock, getOrCreateBatchId } from "./state.js";
import { fbGetRecentPosts, fbGetTopLevelComments, fbPageAlreadyReplied } from "./fb.js";
import { insertReviewItem, countItems } from "./db.js";
import { sendDiscordPreview } from "./discordPreview.js";
import { generateProposal } from "./proposal.js";

export async function runScheduledScan() {
  console.log("⏳ Scheduled scan start");

  if (await isLocked()) {
    console.log("🔒 Locked (waiting for approval). Skip scan.");
    return;
  }

  const batchId = await getOrCreateBatchId();
  const maxBatch = parseInt(process.env.MAX_BATCH_SIZE || "50", 10);
  const lookbackDays = parseInt(process.env.POST_LOOKBACK_DAYS || "7", 10);

  const posts = await fbGetRecentPosts(lookbackDays);
  console.log(`📌 Found posts: ${posts.length}`);

  for (const post of posts) {
    const current = await countItems(batchId);
    if (current >= maxBatch) break;

    const comments = await fbGetTopLevelComments(post.id);
    if (!comments.length) continue;

    for (const c of comments) {
      const countNow = await countItems(batchId);
      if (countNow >= maxBatch) break;

      const msg = (c.message || "").trim();
      if (!msg) continue;

      // Skip if page already replied
      const already = await fbPageAlreadyReplied(c.id);
      if (already) continue;

      const proposal = await generateProposal(msg);
      if (!proposal) continue;

      await insertReviewItem({
        batchId,
        postId: post.id,
        postLink: post.permalink_url,
        commentId: c.id,
        commentText: msg,
        proposedReply: proposal.text,
        impactScore: proposal.score
      });
    }
  }

  const total = await countItems(batchId);
  console.log(`🧾 Batch items: ${total}`);

  if (total > 0) {
    await lock();
    await sendDiscordPreview(batchId);
    console.log("📨 Sent Discord preview + locked.");
  } else {
    console.log("✅ No eligible comments. Nothing to preview.");
  }
}
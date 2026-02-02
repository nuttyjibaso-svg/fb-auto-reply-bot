import { fetchDueOutboxItem, markOutboxSent, markOutboxFailed } from "./db.js";
import { fbReplyToComment } from "./fb.js";

export async function tickOutbox() {
  const item = await fetchDueOutboxItem();
  if (!item) return;

  const dry = (process.env.DRY_RUN || "true") === "true";

  try {
    if (dry) {
      console.log("[DRY_RUN] Would reply:", item.comment_id, item.reply_text);
      await markOutboxSent(item.id);
      return;
    }

    const r = await fbReplyToComment(item.comment_id, item.reply_text);
    if (r?.id) {
      console.log("✅ Sent reply:", r.id);
      await markOutboxSent(item.id);
    } else {
      await markOutboxFailed(item.id, "fb_reply_failed");
    }
  } catch (e) {
    console.error(e);
    await markOutboxFailed(item.id, "exception");
  }
}
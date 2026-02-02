import { unlock } from "./state.js";
import { setBatchStatus, enqueueApprovedBatch, removeReviewItem } from "./db.js";

function okToken(req) {
  return (req.query.token || "") === process.env.ADMIN_APPROVE_TOKEN;
}

export async function approveBatch(req, res) {
  try {
    if (!okToken(req)) return res.status(403).send("Forbidden");
    const batchId = String(req.query.batch_id || "").trim();
    if (!batchId) return res.status(400).send("Missing batch_id");

    await setBatchStatus(batchId, "APPROVED");
    await enqueueApprovedBatch(batchId);
    await unlock();

    res.send(`✅ Approved ${batchId}. Queued replies (slow schedule).`);
  } catch (e) {
    console.error(e);
    res.status(500).send("Error");
  }
}

export async function rejectBatch(req, res) {
  try {
    if (!okToken(req)) return res.status(403).send("Forbidden");
    const batchId = String(req.query.batch_id || "").trim();
    if (!batchId) return res.status(400).send("Missing batch_id");

    await setBatchStatus(batchId, "REJECTED");
    await unlock();

    res.send(`❌ Rejected ${batchId}. Nothing will be sent.`);
  } catch (e) {
    console.error(e);
    res.status(500).send("Error");
  }
}

export async function removeItem(req, res) {
  try {
    if (!okToken(req)) return res.status(403).send("Forbidden");

    const batchId = String(req.query.batch_id || "").trim();
    const itemId = parseInt(String(req.query.item_id || "0"), 10);

    if (!batchId || !itemId) return res.status(400).send("Missing params");

    await removeReviewItem(batchId, itemId);

    res.send(`🗑️ Removed item #${itemId} from ${batchId}`);
  } catch (e) {
    console.error(e);
    res.status(500).send("Error");
  }
}
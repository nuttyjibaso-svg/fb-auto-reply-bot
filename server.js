import express from "express";
import dotenv from "dotenv";
import cron from "node-cron";

import { initDb } from "./src/db.js";
import { runScheduledScan } from "./src/scheduledScan.js"; // PART 2 file
import { tickOutbox } from "./src/outboxWorker.js";        // PART 2 file
import { approveBatch, rejectBatch, removeItem } from "./src/admin.js"; // PART 2 file

dotenv.config();

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => res.status(200).send("ok"));

/**
 * Admin links (clicked from Discord preview)
 */
app.get("/admin/approve_batch", approveBatch);
app.get("/admin/reject_batch", rejectBatch);
app.get("/admin/remove_item", removeItem);

const PORT = process.env.PORT || 3000;

await initDb();

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

/**
 * Scheduled scans: 06:00 / 12:00 / 18:00 Asia/Bangkok
 */
cron.schedule("0 6 * * *", () => runScheduledScan().catch(console.error), {
  timezone: "Asia/Bangkok"
});
cron.schedule("0 12 * * *", () => runScheduledScan().catch(console.error), {
  timezone: "Asia/Bangkok"
});
cron.schedule("0 18 * * *", () => runScheduledScan().catch(console.error), {
  timezone: "Asia/Bangkok"
});

console.log("⏰ Scheduled scans set: 06:00 / 12:00 / 18:00 Asia/Bangkok");

/**
 * Outbox worker tick (checks if a reply is due)
 * Runs every 60 seconds.
 */
setInterval(() => {
  tickOutbox().catch(console.error);
}, 60 * 1000);
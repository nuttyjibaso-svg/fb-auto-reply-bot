import fs from "fs/promises";
import { detectLang, truncate } from "./utils.js";
import { loadAnswerBank } from "./answerBank.js";
import { embedTexts, responseText } from "./openai.js";

const VEC_CACHE_PATH = "/data/answer_bank_vectors.json";

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

function shouldRewrite() {
  const pct = parseInt(process.env.REWRITE_PERCENT || "30", 10); // rewrite 30%
  const roll = Math.floor(Math.random() * 100) + 1; // 1..100
  return roll <= pct;
}

async function loadVectorCache() {
  try {
    const raw = await fs.readFile(VEC_CACHE_PATH, "utf-8");
    const j = JSON.parse(raw);
    if (!Array.isArray(j?.items)) return { version: 1, items: [] };
    return j;
  } catch {
    return { version: 1, items: [] };
  }
}

async function saveVectorCache(items) {
  await fs.writeFile(VEC_CACHE_PATH, JSON.stringify({ version: 1, items }), "utf-8");
}

/**
 * Ensure we have embeddings for each answer text (cached in /data)
 */
async function ensureBankVectors(bank) {
  const cached = await loadVectorCache();
  const cachedByText = new Map((cached.items || []).map(it => [it.text, it.vec]));

  const answers = bank.answers || [];
  const missing = answers.filter(a => !cachedByText.has(a.text));

  let items = cached.items || [];

  if (missing.length > 0) {
    const vecs = await embedTexts(missing.map(m => m.text));
    if (vecs) {
      for (let i = 0; i < missing.length; i++) {
        items.push({
          id: missing[i].id || "",
          lang: missing[i].lang || "en",
          text: missing[i].text,
          vec: vecs[i]
        });
      }
      await saveVectorCache(items);
    }
  }

  return items;
}

/**
 * Create a proposed reply for a comment.
 * Returns: { text, score } or null
 */
export async function generateProposal(commentText) {
  const bank = await loadAnswerBank();
  if (!bank.answers || bank.answers.length === 0) return null;

  const lang = detectLang(commentText);

  // Optional: quick hard-skip for risky keywords (basic)
  // You can expand later
  const lower = commentText.toLowerCase();
  const risky = ["refund", "payment", "scam", "ban", "hack", "suicide", "kill"];
  if (risky.some(w => lower.includes(w))) return null;

  const vectors = await ensureBankVectors(bank);
  const bankItems = vectors.filter(v => (v.lang || "en") === lang);
  if (bankItems.length === 0) return null;

  const commentVecs = await embedTexts([commentText]);
  if (!commentVecs) return null;
  const commentVec = commentVecs[0];

  // Top candidates by similarity
  const scored = bankItems
    .map(it => ({ ...it, sim: cosine(commentVec, it.vec) }))
    .sort((a, b) => b.sim - a.sim)
    .slice(0, 5);

  const maxChars = parseInt(process.env.MAX_REPLY_CHARS || "140", 10);

  for (const cand of scored) {
    let finalText = "";

    // ✅ 70%: use bank text as-is, 30%: rewrite slightly
    if (shouldRewrite()) {
      const remixed = await remixOnly(commentText, cand.text, lang, maxChars);
      if (!remixed) continue;
      finalText = remixed;
    } else {
      finalText = truncate(cand.text, maxChars);
    }

    // Always impact check
    const impact = await impactCheck(commentText, finalText, lang);
    if (!impact) continue;
    if (impact.risk !== "low") continue;
    if (impact.score < 75) continue;

    return { text: finalText, score: impact.score };
  }

  return null;
}

async function remixOnly(original, template, lang, maxChars) {
  const prompt =
    lang === "th"
      ? [
          "คุณเป็นผู้ช่วยเขียนคอมเมนต์ตอบกลับบนเพจ Facebook",
          "ให้รีไรท์จาก TEMPLATE ให้ดูเป็นมนุษย์ขึ้นเล็กน้อย (ความหมายเดิม)",
          "ข้อห้าม:",
          "- ห้ามเพิ่มข้อมูลใหม่/อ้างว่าแจก/ให้ของ/ส่วนลด ถ้า TEMPLATE ไม่ได้บอก",
          "- ห้ามประชด/เสียดสี",
          "- ห้ามบอกว่าเป็นบอทหรืออัตโนมัติ",
          `จำกัดไม่เกิน ${maxChars} ตัวอักษร`,
          "",
          `ORIGINAL_COMMENT: ${original}`,
          `TEMPLATE: ${template}`,
          "",
          "ตอบกลับเป็นข้อความบรรทัดเดียวเท่านั้น"
        ].join("\n")
      : [
          "You write Facebook page replies.",
          "Rewrite ONLY the TEMPLATE to sound slightly more human, same meaning.",
          "Do not add new claims. No sarcasm. Do not mention bots/automation.",
          `Max ${maxChars} characters. One line only.`,
          "",
          `ORIGINAL_COMMENT: ${original}`,
          `TEMPLATE: ${template}`
        ].join("\n");

  const out = await responseText(prompt);
  if (!out) return null;
  return truncate(out, maxChars);
}

async function impactCheck(original, reply, lang) {
  const prompt =
    lang === "th"
      ? [
          "ประเมินว่าคำตอบนี้ทำให้คนคอมเมนต์รู้สึกดีหรือไม่",
          "ตอบเป็น JSON เท่านั้น ไม่มีข้อความอื่น",
          "ฟิลด์: score (0-100), risk (low|med|high), reason",
          "ถ้าดูประชด เสียดสี ไม่ให้เกียรติ หรือเสี่ยงดราม่า ให้ risk=high และ score ต่ำ",
          "",
          `COMMENT: ${original}`,
          `REPLY: ${reply}`
        ].join("\n")
      : [
          "Judge whether this reply will likely make the commenter feel good.",
          "Return JSON only: score (0-100), risk (low|med|high), reason.",
          "If sarcastic/dismissive/drama-prone: risk=high and low score.",
          "",
          `COMMENT: ${original}`,
          `REPLY: ${reply}`
        ].join("\n");

  const out = await responseText(prompt);
  if (!out) return null;

  try {
    const j = JSON.parse(out);
    return {
      score: Number(j.score ?? 0),
      risk: String(j.risk ?? "high"),
      reason: String(j.reason ?? "")
    };
  } catch {
    return null;
  }
}
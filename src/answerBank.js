import fs from "fs/promises";

export async function loadAnswerBank() {
  const path = process.env.BANK_PATH || "/data/answer_bank.json";

  try {
    const raw = await fs.readFile(path, "utf-8");
    const bank = JSON.parse(raw);

    const answers = Array.isArray(bank?.answers) ? bank.answers : [];

    // Keep only entries with text; safe defaults to true
    const cleaned = answers
      .filter(a => a && typeof a.text === "string" && a.text.trim().length > 0)
      .filter(a => a.safe !== false);

    return {
      version: bank?.version ?? 1,
      languages: bank?.languages ?? ["th", "en"],
      answers: cleaned
    };
  } catch (e) {
    console.error("Answer bank load failed:", e?.message || e);
    return { version: 1, languages: ["th", "en"], answers: [] };
  }
}
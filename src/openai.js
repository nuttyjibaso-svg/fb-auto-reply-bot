import fetch from "node-fetch";

function key() {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("Missing OPENAI_API_KEY");
  return k;
}

export async function embedTexts(texts) {
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: texts
    })
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("OpenAI embeddings error:", j);
    return null;
  }

  return (j.data || []).map(d => d.embedding);
}

export async function responseText(prompt) {
  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      input: prompt
    })
  });

  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("OpenAI responses error:", j);
    return null;
  }

  const text = j?.output?.[0]?.content?.[0]?.text;
  return (text || "").trim();
}
export function nowIso() {
  return new Date().toISOString();
}

export function daysAgoDate(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

export function toUnixSeconds(date) {
  return Math.floor(date.getTime() / 1000);
}

export function detectLang(text) {
  // Thai Unicode block
  return /[\u0E00-\u0E7F]/.test(text) ? "th" : "en";
}

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function truncate(s, n) {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (t.length <= n) return t;
  return t.slice(0, n - 1) + "…";
}
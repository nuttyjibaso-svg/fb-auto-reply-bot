import fetch from "node-fetch";
import { daysAgoDate, toUnixSeconds } from "./utils.js";

const GRAPH = "https://graph.facebook.com/v24.0";

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing ${name}`);
  return v;
}

function pageId() {
  return mustEnv("FB_PAGE_ID");
}

function token() {
  return mustEnv("FB_PAGE_ACCESS_TOKEN");
}

async function fbGet(url) {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("FB GET error:", j);
    return null;
  }
  return j;
}

async function fbPost(url) {
  const r = await fetch(url, { method: "POST" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error("FB POST error:", j);
    return null;
  }
  return j;
}

/**
 * Get recent Page posts from last N days
 * Uses: /{page-id}/feed
 */
export async function fbGetRecentPosts(lookbackDays) {
  const since = toUnixSeconds(daysAgoDate(lookbackDays));

  const url = new URL(`${GRAPH}/${pageId()}/feed`);
  url.searchParams.set("since", String(since));
  url.searchParams.set("limit", "25");
  url.searchParams.set("fields", "id,permalink_url,created_time");
  url.searchParams.set("access_token", token());

  const out = [];
  let next = url.toString();

  while (next) {
    const j = await fbGet(next);
    if (!j?.data) break;

    for (const p of j.data) {
      out.push({
        id: p.id,
        permalink_url: p.permalink_url || ""
      });
    }

    next = j?.paging?.next || null;
    if (out.length > 300) break; // safety
  }

  return out;
}

/**
 * Get top-level comments for a post
 * Uses: /{post-id}/comments
 */
export async function fbGetTopLevelComments(postId) {
  const url = new URL(`${GRAPH}/${postId}/comments`);
  url.searchParams.set("filter", "stream");
  url.searchParams.set("order", "reverse_chronological");
  url.searchParams.set("limit", "50");
  url.searchParams.set("fields", "id,message,from,created_time");
  url.searchParams.set("access_token", token());

  const out = [];
  let next = url.toString();

  while (next) {
    const j = await fbGet(next);
    if (!j?.data) break;

    for (const c of j.data) {
      out.push({
        id: c.id,
        message: c.message || ""
      });
    }

    next = j?.paging?.next || null;
    if (out.length > 800) break; // safety
  }

  return out;
}

/**
 * Check if OUR PAGE already replied to this comment:
 * /{comment-id}/comments → look for from.id == FB_PAGE_ID
 */
export async function fbPageAlreadyReplied(commentId) {
  const url = new URL(`${GRAPH}/${commentId}/comments`);
  url.searchParams.set("limit", "25");
  url.searchParams.set("fields", "id,from");
  url.searchParams.set("access_token", token());

  const j = await fbGet(url.toString());
  const replies = j?.data || [];

  for (const r of replies) {
    if (r?.from?.id && String(r.from.id) === String(pageId())) return true;
  }
  return false;
}

/**
 * Reply to a comment:
 * POST /{comment-id}/comments?message=...
 */
export async function fbReplyToComment(commentId, message) {
  const url = new URL(`${GRAPH}/${commentId}/comments`);
  url.searchParams.set("message", message);
  url.searchParams.set("access_token", token());
  return await fbPost(url.toString());
}
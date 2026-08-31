/**
 * Shared Meta Graph API helpers for the ad-launch endpoints (boost-reel,
 * launch-reels, launch-carousel). The ad account can be throttled to one
 * write per 30 seconds (code 613 / subcode 4841018); fbPost waits out the
 * window and retries instead of failing a whole launch on the first
 * throttle, and stops cleanly if a retry would run past the caller's own
 * time budget rather than let the platform kill the function silently
 * mid-build, leaving a half-created campaign with no error at all.
 *
 * Underscore-prefixed so Vercel does NOT expose it as a route.
 */

const FB_BASE = 'https://graph.facebook.com/v21.0';
// Clears Facebook's ~30s per-write throttle window.
const RETRY_SLEEP_MS = 32000;

export async function fbGet(path) {
  const token = process.env.META_ADS_ACCESS_TOKEN;
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${FB_BASE}${path}${sep}access_token=${token}`);
  const data = await res.json();
  if (data.error) throw new Error(`FB GET ${path}: ${data.error.message}`);
  return data;
}

/**
 * @param {string} path
 * @param {object} body
 * @param {number} [deadline] Date.now()-style timestamp. If a retry would sleep
 *   past it, fbPost fails cleanly with a clear error instead of risking the
 *   platform killing the whole function mid-write. Pass the caller's own
 *   deadline (computed once at the top of the handler); omit only for calls
 *   with no realistic risk of compounding retries.
 */
export async function fbPost(path, body, deadline) {
  const token = process.env.META_ADS_ACCESS_TOKEN;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${FB_BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, access_token: token }),
    });
    const data = await res.json();
    if (!data.error) return data;
    const e = data.error;
    if (e.code === 613 && attempt < 3) {
      if (deadline && Date.now() + RETRY_SLEEP_MS > deadline) {
        throw new Error(`FB POST ${path}: still rate-limited but out of time before this run's own deadline. Stopped cleanly instead of letting the platform kill it mid-build; nothing after this call was created. Safe to retry the same request in a minute.`);
      }
      await new Promise((r) => setTimeout(r, RETRY_SLEEP_MS));
      continue;
    }
    throw new Error(`FB POST ${path}: ${e.message}` +
      (e.error_user_msg ? ` | ${e.error_user_title}: ${e.error_user_msg}` : '') +
      (e.error_subcode ? ` | subcode=${e.error_subcode}` : ''));
  }
}

export async function fbDelete(path) {
  const token = process.env.META_ADS_ACCESS_TOKEN;
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${FB_BASE}${path}${sep}access_token=${token}`, { method: 'DELETE' });
  return res.json().catch(() => ({}));
}

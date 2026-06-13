/**
 * Instagram access-token brain — single source of truth for the live token.
 *
 * Why this exists:
 *   Instagram long-lived tokens expire 60 days after they're issued. They can be
 *   *refreshed* (any time the token is >24h old) which mints a fresh 60-day token.
 *   A running Vercel function can't rewrite its own env var, so instead we keep the
 *   current token in Supabase (table `ig_token`) and a weekly cron refreshes it.
 *
 * getIgToken()    — what every consumer (website + crons) calls to get the token.
 *                   Reads Supabase; falls back to the INSTAGRAM_ACCESS_TOKEN env
 *                   var when the table is empty (first-ever run / bootstrap) or if
 *                   Supabase is unreachable. So this is always safe — it can never
 *                   return nothing the env var wouldn't have returned.
 * refreshIgToken() — called by the cron. Refreshes the current token with Instagram
 *                    and writes the new token + expiry back to Supabase.
 */

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const IG_GRAPH = 'https://graph.instagram.com';

function sbHeaders() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}` };
}

/**
 * Current live Instagram token. Prefers the auto-refreshed token in Supabase,
 * falls back to the env var so nothing breaks before the first refresh runs.
 * @returns {Promise<string|undefined>}
 */
export async function getIgToken() {
  const envToken = process.env.INSTAGRAM_ACCESS_TOKEN;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/ig_token?id=eq.instagram&select=access_token&limit=1`,
      { headers: sbHeaders() }
    );
    if (res.ok) {
      const rows = await res.json();
      if (rows[0]?.access_token) return rows[0].access_token;
    }
  } catch {
    // Supabase unreachable — fall back to env token below.
  }
  return envToken;
}

/**
 * Refresh the current long-lived token with Instagram and persist the result.
 * Each successful refresh resets the clock to ~60 days from now.
 * @returns {Promise<{expires_in:number, expires_at:string, rotated:boolean}>}
 */
export async function refreshIgToken() {
  const current = await getIgToken();
  if (!current) throw new Error('No current Instagram token to refresh');

  const res = await fetch(
    `${IG_GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${current}`
  );
  const data = await res.json();
  if (!res.ok || data.error || !data.access_token) {
    throw new Error(`IG refresh failed: ${data.error?.message || JSON.stringify(data)}`);
  }

  const now = new Date();
  const expiresAt = new Date(now.getTime() + (data.expires_in ?? 0) * 1000).toISOString();

  const up = await fetch(`${SUPABASE_URL}/rest/v1/ig_token?on_conflict=id`, {
    method: 'POST',
    headers: {
      ...sbHeaders(),
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
    },
    body: JSON.stringify([{
      id: 'instagram',
      access_token: data.access_token,
      expires_at: expiresAt,
      refreshed_at: now.toISOString(),
      updated_at: now.toISOString(),
    }]),
  });
  if (!up.ok) throw new Error(`Supabase write failed: ${await up.text()}`);

  return {
    expires_in: data.expires_in ?? 0,
    expires_at: expiresAt,
    rotated: data.access_token !== current,
  };
}

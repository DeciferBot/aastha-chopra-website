/**
 * Instagram token keep-alive — Vercel Cron (weekly).
 *
 * Instagram long-lived tokens expire 60 days after issue but can be refreshed
 * any time they're >24h old, each refresh minting a fresh 60-day token. Running
 * this weekly keeps the token permanently alive with a huge safety margin (one
 * refresh buys ~8 weeks; we refresh every week).
 *
 * The new token is stored in Supabase (table `ig_token`); the whole site reads
 * from there via getIgToken(), so the token renews itself with no redeploy.
 *
 * GET /api/cron/ig-token-refresh   (Authorization: Bearer CRON_SECRET)
 */

import { refreshIgToken } from '../_igtoken.js';

export default async function handler(req, res) {
  const authHeader = req.headers.authorization;
  const validCron   = authHeader === `Bearer ${process.env.CRON_SECRET}`;
  const validManual = !!process.env.MANUAL_SYNC_KEY && authHeader === `Bearer ${process.env.MANUAL_SYNC_KEY}`;
  if (!validCron && !validManual) return res.status(401).end();

  try {
    const result = await refreshIgToken();
    return res.status(200).json({
      ok: true,
      rotated: result.rotated,
      expires_in_days: Math.round(result.expires_in / 86400),
      expires_at: result.expires_at,
    });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message });
  }
}

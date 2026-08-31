/**
 * Shared outreach configuration — the single place that decides who is worth
 * chasing. Used by the email-pitch cron, the Instagram-DM cron, and the
 * on-demand "send me this pitch" button, so a rule like "focus on brands
 * that pay" or "5 pitches a week" can only ever be changed in one place.
 *
 * Underscore-prefixed so Vercel does NOT expose it as a route.
 */

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

export async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase: ${await res.text()}`);
  return res.json();
}

// The segments Aastha actually creates in, weighted toward budgets that pay:
// hotels, travel, retail chains, and FMCG beauty. Cars stay out.
export const OUTREACH_SEGMENTS = ['beauty', 'fashion', 'fragrance', 'jewellery', 'wellness', 'hospitality', 'travel', 'retail'];

// Money weighting (Amit, 2026-08-31: "focus on things that pay"). A small
// local studio only surfaces when no major or mid brand is available.
export const BUDGET_WEIGHT = { major: 3, mid: 1, small: -2 };

/** The one ranking rule both outreach channels sort candidates by. */
export function byBudgetThenScore(a, b) {
  return ((BUDGET_WEIGHT[b.budget_tier] ?? 1) - (BUDGET_WEIGHT[a.budget_tier] ?? 1)) ||
    ((b.fit_score ?? 0) - (a.fit_score ?? 0));
}

const WEEKLY_LIMIT = Number(process.env.OUTREACH_WEEKLY_LIMIT || 5);

/**
 * The 5-a-week rule, checked once from here so every path that can create a
 * real brand-facing pitch (the daily cron AND the on-demand button) shares
 * the same counter and can't silently disagree about how much budget is
 * left. DM-channel rows ('dm') are a separate, unlimited channel Aastha
 * sends herself, so they don't count. 'failed' rows (a send that never
 * actually reached anyone) don't count either.
 */
export async function weeklyQuota() {
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const rows = await sb(`/brand_pitches?select=id&generated_at=gte.${weekAgo}&status=not.in.(dm,failed)`).catch(() => []);
  const used = (rows || []).length;
  return { used, limit: WEEKLY_LIMIT, remaining: Math.max(0, WEEKLY_LIMIT - used) };
}

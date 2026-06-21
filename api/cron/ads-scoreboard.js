export const config = { maxDuration: 60 };

/**
 * Ads Scoreboard — read-only follower-growth instrument
 *
 * The north star is NET FOLLOWER GROWTH, not profile visits. This joins:
 *   - Meta ad insights (per campaign): spend, profile visits, cost/visit, and
 *     EVERY action_type the API exposes (so we can see whether ad-driven
 *     "follows" are actually retrievable — the docs suggest no follow action
 *     type exists; this proves it empirically per campaign).
 *   - Supabase `instagram_snapshots`: daily followers_count → net follower delta
 *     over the window = the real outcome.
 * Output = blended cost-per-net-follower + per-campaign visit efficiency, so
 * after a 7-day window the data says which cells to scale and which to stop.
 *
 * Read-only. Creates/changes nothing. GET /api/cron/ads-scoreboard[?days=7]
 *   Auth: Bearer CRON_SECRET | MANUAL_SYNC_KEY
 */

const FB_BASE      = 'https://graph.facebook.com/v21.0';
const AD_ACCOUNT   = '1508208884141959';
const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';

function ymd(d) { return d.toISOString().slice(0, 10); }

async function fbGet(path) {
  const token = process.env.META_ADS_ACCESS_TOKEN;
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${FB_BASE}${path}${sep}access_token=${token}`);
  const data = await res.json();
  if (data.error) throw new Error(`FB GET ${path}: ${data.error.message}`);
  return data;
}

async function sbGet(path) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: HTTP ${res.status}`);
  return res.json();
}

// Persist the day's window aggregate (upsert by date) → analytics dashboard reads it.
async function sbUpsertDaily(row) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) return;
  await fetch(`${SUPABASE_URL}/rest/v1/ads_scoreboard_daily?on_conflict=date`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(row),
  }).catch(() => {});
}

// Pull the profile-visit + any follow value out of an insights actions[] array.
function readActions(actions = []) {
  const map = {};
  for (const a of actions) map[a.action_type] = Number(a.value);
  // Meta reports IG profile visits under one of these action types depending on
  // optimization; sum the profile-visit-ish ones, and look for any 'follow'.
  const profileVisits =
    map['onsite_conversion.ig_profile_visit'] ??
    map['onsite_conversion.ig_profile_engagement'] ??
    map['link_click'] ?? 0;
  const followKey = Object.keys(map).find((k) => /follow/i.test(k));
  return { profileVisits, follows: followKey ? map[followKey] : null, followKey: followKey || null, all: map };
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const ok = [process.env.CRON_SECRET, process.env.MANUAL_SYNC_KEY]
    .filter(Boolean).some((k) => auth === `Bearer ${k}`);
  if (!ok) return res.status(401).end();
  if (!process.env.META_ADS_ACCESS_TOKEN) return res.status(500).json({ error: 'Missing META_ADS_ACCESS_TOKEN' });

  const days = Math.max(1, Math.min(90, parseInt(req.query?.days, 10) || 7));
  const until = new Date();
  const since = new Date(until.getTime() - (days - 1) * 86400000);
  const timeRange = JSON.stringify({ since: ymd(since), until: ymd(until) });

  try {
    // 1. Per-campaign ad insights over the window.
    const ins = await fbGet(
      `/act_${AD_ACCOUNT}/insights?level=campaign&time_range=${encodeURIComponent(timeRange)}` +
      `&fields=campaign_name,spend,reach,impressions,actions&limit=200`
    );
    let anyFollowMetric = false;
    const campaigns = (ins.data || []).map((c) => {
      const { profileVisits, follows, followKey } = readActions(c.actions);
      if (follows != null) anyFollowMetric = true;
      const spend = Number(c.spend || 0);
      return {
        campaign: c.campaign_name,
        spend: Number(spend.toFixed(2)),
        reach: Number(c.reach || 0),
        profile_visits: profileVisits,
        cost_per_visit: profileVisits ? Number((spend / profileVisits).toFixed(3)) : null,
        ad_reported_follows: follows,
        follow_action_type: followKey,
      };
    }).sort((a, b) => b.spend - a.spend);

    const totalSpend = Number(campaigns.reduce((s, c) => s + c.spend, 0).toFixed(2));
    const totalVisits = campaigns.reduce((s, c) => s + (c.profile_visits || 0), 0);

    // 2. Follower delta from snapshots over the window.
    const snaps = await sbGet(
      `/instagram_snapshots?snapshot_date=gte.${ymd(since)}&select=snapshot_date,followers_count,reach_day&order=snapshot_date.asc`
    );
    const first = snaps[0] || null;
    const last = snaps[snaps.length - 1] || null;
    const followerDelta = first && last ? last.followers_count - first.followers_count : null;
    const costPerNetFollower = followerDelta && followerDelta > 0
      ? Number((totalSpend / followerDelta).toFixed(2)) : null;

    // 3. Persist the day's window aggregate for the analytics dashboard.
    if (req.query?.nostore !== '1' && last) {
      await sbUpsertDaily({
        date: ymd(until),
        followers_count: last.followers_count,
        spend_aed: totalSpend,
        profile_visits: totalVisits,
        cost_per_visit: totalVisits ? Number((totalSpend / totalVisits).toFixed(4)) : null,
        campaigns,
      });
    }

    return res.status(200).json({
      ok: true,
      window: { since: ymd(since), until: ymd(until), days },
      north_star: {
        followers_start: first?.followers_count ?? null,
        followers_end: last?.followers_count ?? null,
        net_follower_delta: followerDelta,
        total_ad_spend_aed: totalSpend,
        cost_per_net_follower_aed: costPerNetFollower,
        verdict: followerDelta == null ? 'no snapshot data'
          : followerDelta > 0 ? 'growing'
          : followerDelta === 0 ? 'flat' : 'declining',
      },
      ad_follows_available_in_api: anyFollowMetric,
      totals: { spend_aed: totalSpend, profile_visits: totalVisits },
      campaigns,
      follower_trend: snaps.map((s) => ({ date: s.snapshot_date, followers: s.followers_count })),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

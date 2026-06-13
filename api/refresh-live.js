/**
 * Live freshness for the analytics tab — the "fast path" subset of ig-sync.
 *
 * The tab renders from Supabase (refreshed by the 4-hourly ig-sync cron), so when
 * Aastha opens it the numbers can be hours old. On open the tab calls this endpoint,
 * which pulls ONLY her current account snapshot + audience demographics (no media /
 * post-insights sweep, so it returns in seconds), upserts them, and reports the fresh
 * values. The tab then re-renders North Star + Your Audience in place.
 *
 * Staleness-guarded: if the stored data is younger than STALE_MIN it skips the IG
 * calls and returns {refreshed:false} so reloads don't hammer the Graph API. ?force=1
 * overrides the guard.
 *
 * Auth: the analytics_auth cookie (same gate as the tab). POST.
 */

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const IG_BASE      = 'https://graph.instagram.com/v21.0';
const STALE_MIN    = 10;

async function ig(path, token) {
  const sep = path.includes('?') ? '&' : '?';
  const res = await fetch(`${IG_BASE}${path}${sep}access_token=${token}`);
  const data = await res.json();
  if (data.error) throw new Error(`IG ${path}: ${data.error.message}`);
  return data;
}

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates,return=minimal',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${opts.method || 'GET'} ${path}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pull one demographics metric across its breakdowns into flat rows.
async function fetchDemo(metric, breakdowns, token, extra = '') {
  const rows = [];
  const now = new Date().toISOString();
  for (const breakdown of breakdowns) {
    try {
      const data = await ig(
        `/me/insights?metric=${metric}&period=lifetime&breakdown=${breakdown}&metric_type=total_value${extra}`,
        token
      );
      const results = data.data?.[0]?.total_value?.breakdowns?.[0]?.results || [];
      results.forEach((item) => rows.push({
        synced_at: now,
        metric,
        breakdown,
        dimension: item.dimension_values?.[0] ?? item.dimension_value ?? String(item.value),
        value: item.value,
      }));
      await sleep(200);
    } catch { /* skip metric/breakdown not available */ }
  }
  return rows;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const cookie = req.headers.cookie || '';
  if (!/(?:^|;\s*)analytics_auth=1(?:;|$)/.test(cookie)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return res.status(200).json({ ok: false, refreshed: false, error: 'no token' });

  try {
    // Staleness guard: how fresh is what we already have?
    const force = req.query?.force === '1';
    const latest = await sb('/instagram_demographics?select=synced_at&order=synced_at.desc&limit=1');
    const lastSync = latest?.[0]?.synced_at ? new Date(latest[0].synced_at).getTime() : 0;
    const ageMin = (Date.now() - lastSync) / 60000;
    if (!force && lastSync && ageMin < STALE_MIN) {
      return res.status(200).json({ ok: true, refreshed: false, asOf: latest[0].synced_at, ageMin: Math.round(ageMin) });
    }

    // 1. Account snapshot (followers + today's reach).
    const today = new Date().toISOString().slice(0, 10);
    const [profileRes, insightsRes] = await Promise.all([
      ig('/me?fields=followers_count,media_count', token),
      ig('/me/insights?metric=reach,profile_views,website_clicks&period=day', token).catch(() => ({ data: [] })),
    ]);
    const im = {};
    (insightsRes.data || []).forEach((m) => { const v = m.values?.[m.values.length - 1]; if (v) im[m.name] = v.value; });
    await sb('/instagram_snapshots?on_conflict=snapshot_date', {
      method: 'POST',
      body: JSON.stringify([{
        snapshot_date: today,
        followers_count: profileRes.followers_count ?? null,
        media_count: profileRes.media_count ?? null,
        reach_day: im.reach ?? null,
        profile_views: im.profile_views ?? null,
        website_clicks: im.website_clicks ?? null,
      }]),
    });

    // 2. Demographics — followers (who follows) + reached (who she reaches).
    const demoRows = [
      ...(await fetchDemo('follower_demographics', ['age', 'gender', 'city', 'country'], token)),
      ...(await fetchDemo('reached_audience_demographics', ['country', 'city'], token, '&timeframe=last_30_days')),
    ];
    if (demoRows.length) {
      await sb(`/instagram_demographics?synced_at=gte.${today}T00:00:00Z`, { method: 'DELETE' });
      await sb('/instagram_demographics', { method: 'POST', body: JSON.stringify(demoRows) });
    }

    const countries = demoRows.filter((r) => r.metric === 'follower_demographics' && r.breakdown === 'country');
    const reached = demoRows.filter((r) => r.metric === 'reached_audience_demographics' && r.breakdown === 'country');
    return res.status(200).json({
      ok: true, refreshed: true, asOf: new Date().toISOString(),
      followers: profileRes.followers_count ?? null,
      uaeFollowers: countries.find((r) => r.dimension === 'AE')?.value ?? null,
      uaeReach: reached.find((r) => r.dimension === 'AE')?.value ?? null,
    });
  } catch (e) {
    return res.status(500).json({ ok: false, refreshed: false, error: e.message });
  }
}

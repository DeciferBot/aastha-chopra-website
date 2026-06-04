/**
 * Live Instagram stats from Supabase — used to hydrate hardcoded numbers on every page.
 * Cached at the CDN edge for 4 hours (aligns with ig-sync cron cadence).
 * GET /api/ig-stats
 */

export const config = { runtime: 'edge' };

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';

async function sbGet(path) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${res.status}`);
  return res.json();
}

export default async function handler(req) {
  try {
    const [snapshot, postStats, demographics] = await Promise.all([
      // Latest follower count
      sbGet('/instagram_snapshots?order=snapshot_date.desc&limit=1&select=followers_count,snapshot_date'),

      // Aggregate post stats — fetch up to 3000 rows, Supabase default cap is 1000 so set explicitly
      sbGet('/instagram_posts?select=reach,total_interactions,media_type,timestamp&limit=3000'),

      // Latest demographics (most recent synced_at batch)
      sbGet('/instagram_demographics?order=synced_at.desc&limit=200&select=metric,breakdown,dimension,value,synced_at'),
    ]);

    // ── Follower count ──
    const followers = snapshot[0]?.followers_count ?? null;

    // ── Post stats ──
    const posts = postStats || [];
    const postCount = posts.length;

    // Engagement rate: median of (total_interactions / reach * 100), min reach 200 to exclude outliers
    const erPosts = posts.filter(p => p.reach >= 200 && p.total_interactions != null);
    const erRates = erPosts.map(p => (p.total_interactions / p.reach) * 100).sort((a, b) => a - b);
    const avgEngagementRate = erRates.length
      ? erRates[Math.floor(erRates.length / 2)]  // median
      : null;

    // Peak single-post reach
    const maxReach = posts.reduce((max, p) => Math.max(max, p.reach || 0), 0);

    // Monthly reach: sum reach of posts in last 30 days
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const recentPosts = posts.filter(p => p.timestamp >= thirtyDaysAgo);
    const monthlyReach = recentPosts.reduce((sum, p) => sum + (p.reach || 0), 0);

    // Weekly reach: posts in last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const weeklyPosts = posts.filter(p => p.timestamp >= sevenDaysAgo);
    const weeklyReach = weeklyPosts.reduce((sum, p) => sum + (p.reach || 0), 0);

    // ── Demographics ──
    // Get most recent batch (same synced_at prefix)
    const latestBatchTime = demographics[0]?.synced_at;
    const latestDemo = latestBatchTime
      ? demographics.filter(d => d.synced_at === latestBatchTime)
      : demographics;

    // UAE %: country breakdown, AE dimension
    const countryRows = latestDemo.filter(d => d.breakdown === 'country');
    const totalCountry = countryRows.reduce((s, d) => s + (d.value || 0), 0);
    const aeRow = countryRows.find(d => d.dimension === 'AE');
    const uaePct = totalCountry > 0 && aeRow
      ? Math.round((aeRow.value / totalCountry) * 100)
      : null;

    // Age 25–44 %
    const ageRows = latestDemo.filter(d => d.breakdown === 'age');
    const totalAge = ageRows.reduce((s, d) => s + (d.value || 0), 0);
    const age2534 = ageRows.find(d => d.dimension === '25-34')?.value || 0;
    const age3544 = ageRows.find(d => d.dimension === '35-44')?.value || 0;
    const age2544Pct = totalAge > 0
      ? Math.round(((age2534 + age3544) / totalAge) * 100)
      : null;

    // Top city
    const cityRows = latestDemo.filter(d => d.breakdown === 'city');
    const topCity = cityRows.sort((a, b) => (b.value || 0) - (a.value || 0))[0]?.dimension ?? null;

    const stats = {
      followers,
      postCount,
      avgEngagementRate: avgEngagementRate ? parseFloat(avgEngagementRate.toFixed(2)) : null,
      maxReach,
      monthlyReach,
      weeklyReach,
      uaePct,
      age2544Pct,
      topCity,
    };

    return new Response(JSON.stringify(stats), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=14400, stale-while-revalidate=3600',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

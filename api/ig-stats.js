/**
 * Live Instagram stats from Supabase — used to hydrate hardcoded numbers on every page.
 * Cached at the CDN edge for 4 hours (aligns with ig-sync cron cadence).
 * GET /api/ig-stats
 */

export const config = { runtime: 'edge' };

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';

export default async function handler(req) {
  try {
    const key = process.env.SUPABASE_SERVICE_KEY;
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_ig_stats`, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!res.ok) throw new Error(`Supabase RPC: ${res.status} ${await res.text()}`);
    const stats = await res.json();

    // Clean up city name ("Dubai, Dubai" → "Dubai")
    if (stats.topCity) {
      stats.topCity = stats.topCity.split(',')[0].trim();
    }

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

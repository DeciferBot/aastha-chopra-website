export const config = { runtime: 'edge' };

const MEDIA_FIELDS = [
  'id', 'caption', 'media_type', 'media_url', 'thumbnail_url',
  'permalink', 'timestamp',
  'like_count', 'comments_count',
  'is_shared_to_feed',
].join(',');

export default async function handler(req) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ error: 'No token configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    // Fetch media
    const mediaRes = await fetch(
      `https://graph.instagram.com/v21.0/me/media?fields=${MEDIA_FIELDS}&limit=12&access_token=${token}`
    );
    const mediaData = await mediaRes.json();

    // Fetch account-level stats
    const accountRes = await fetch(
      `https://graph.instagram.com/v21.0/me?fields=id,username,followers_count,media_count,biography,profile_picture_url&access_token=${token}`
    );
    const accountData = await accountRes.json();

    // Try insights for recent media (requires instagram_manage_insights permission)
    // We attempt per-media insights on the first post to probe what's accessible
    let insightsAvailable = false;
    let sampleInsights = null;
    if (mediaData.data && mediaData.data.length > 0) {
      const firstId = mediaData.data[0].id;
      const insightRes = await fetch(
        `https://graph.instagram.com/v21.0/${firstId}/insights?metric=reach,impressions,engagement,saved&period=lifetime&access_token=${token}`
      );
      const insightData = await insightRes.json();
      if (!insightData.error) {
        insightsAvailable = true;
        sampleInsights = insightData;
      } else {
        sampleInsights = { error: insightData.error.message, code: insightData.error.code };
      }
    }

    return new Response(JSON.stringify({
      account: accountData,
      data: mediaData.data || [],
      paging: mediaData.paging,
      insights_available: insightsAvailable,
      sample_insights: sampleInsights,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=1800, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*'
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

export const config = { runtime: 'edge' };

const MEDIA_FIELDS = [
  'id', 'caption', 'media_type', 'media_url', 'thumbnail_url',
  'permalink', 'timestamp', 'like_count', 'comments_count',
].join(',');

// Metrics per media type (impressions not supported for IMAGE/CAROUSEL)
const IMAGE_METRICS = 'reach,saved,likes,comments,shares,total_interactions';
const VIDEO_METRICS = 'reach,impressions,saved,likes,comments,shares,total_interactions';
const REEL_METRICS  = 'reach,saved,likes,comments,shares,total_interactions,ig_reels_avg_watch_time,ig_reels_video_view_total_time,views';

export default async function handler(req) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ error: 'No token configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  const url = new URL(req.url);
  const withInsights = url.searchParams.get('insights') === '1';
  const limit = parseInt(url.searchParams.get('limit') || '12');

  try {
    // Account stats
    const [mediaRes, accountRes] = await Promise.all([
      fetch(`https://graph.instagram.com/v21.0/me/media?fields=${MEDIA_FIELDS}&limit=${limit}&access_token=${token}`),
      fetch(`https://graph.instagram.com/v21.0/me?fields=id,username,followers_count,media_count,biography,profile_picture_url&access_token=${token}`),
    ]);

    const [mediaData, accountData] = await Promise.all([mediaRes.json(), accountRes.json()]);
    const posts = mediaData.data || [];

    // Optionally fetch per-post insights (heavier — only when ?insights=1)
    if (withInsights && posts.length > 0) {
      const insightResults = await Promise.all(
        posts.map(async (post) => {
          const metrics = post.media_type === 'VIDEO'
            ? REEL_METRICS
            : post.media_type === 'IMAGE'
              ? IMAGE_METRICS
              : IMAGE_METRICS; // CAROUSEL_ALBUM → same as IMAGE
          const res = await fetch(
            `https://graph.instagram.com/v21.0/${post.id}/insights?metric=${metrics}&period=lifetime&access_token=${token}`
          );
          const data = await res.json();
          if (data.error) return { id: post.id, error: data.error.message };
          // Flatten into key:value
          const flat = {};
          (data.data || []).forEach(m => { flat[m.name] = m.values?.[0]?.value ?? m.value; });
          return { id: post.id, ...flat };
        })
      );
      // Merge insights back onto posts
      const insightMap = Object.fromEntries(insightResults.map(r => [r.id, r]));
      posts.forEach(p => { p.insights = insightMap[p.id] || null; });
    }

    return new Response(JSON.stringify({
      account: accountData,
      data: posts,
      paging: mediaData.paging,
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': withInsights ? 's-maxage=600, stale-while-revalidate=3600' : 's-maxage=1800, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*',
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

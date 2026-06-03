export const config = { runtime: 'edge' };

export default async function handler(req) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ error: 'No token configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/me/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp&limit=20&access_token=${token}`
    );
    const data = await res.json();

    const reels = (data.data || [])
      .filter(m => m.media_type === 'VIDEO')
      .slice(0, 4)
      .map(m => ({
        id: m.id,
        caption: m.caption ? m.caption.split('\n')[0].slice(0, 80) : '',
        media_url: m.media_url,
        thumbnail_url: m.thumbnail_url || null,
        permalink: m.permalink,
        timestamp: m.timestamp,
      }));

    return new Response(JSON.stringify({ reels }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=1800, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*',
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }
}

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ error: 'No token configured' }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    });
  }

  try {
    let allMedia = [];
    let url = `https://graph.instagram.com/v21.0/me/media?fields=id,media_type,thumbnail_url,permalink&limit=50&access_token=${token}`;

    while (url && allMedia.length < 100) {
      const res = await fetch(url);
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      allMedia = allMedia.concat(data.data || []);
      url = data.paging?.next || null;
    }

    const thumbMap = {};
    for (const m of allMedia) {
      if (m.thumbnail_url && m.permalink) {
        const match = m.permalink.match(/\/(reel|p)\/([^/]+)\//);
        if (match) thumbMap[match[2]] = m.thumbnail_url;
      }
    }

    const reels = allMedia
      .filter(m => m.media_type === 'VIDEO')
      .slice(0, 4)
      .map(m => ({
        id: m.id,
        thumbnail_url: m.thumbnail_url || null,
        permalink: m.permalink,
      }));

    return new Response(JSON.stringify({ reels, thumbMap }), {
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

export const config = { runtime: 'edge' };

/**
 * GET /api/reels  →  { generated_at, count, reels: [...] }
 *
 * Serves the top reels from Supabase, ranked by real views, using the DURABLE
 * Supabase Storage thumbnails (storage_thumbnail_url) — permanent public URLs,
 * unlike raw Instagram CDN links which expire within days. This mirrors what
 * scripts/sync-reels.mjs bakes into the committed data/reels.json; the static
 * file is what the site reads by default, this endpoint is for live refresh.
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uqzvaytvynrglijvwjsz.supabase.co';

const RULES = [
  ['Beauty', /\b(makeup|lip|lipstick|mascara|concealer|foundation|primer|blush|bronzer|highlighter|eyeshadow|skin|skincare|glow|serum|fragrance|perfume|parfum|scent|beauty|kosas|huda|maybelline|sephora|sephoria|charlotte tilbury|gisou|nars|elf|haircare|hair oil|note cosmet|dolce.{0,3}gabbana beauty|rasasi|under.?eye)\b/i],
  ['Wellness', /\b(hike|hiking|ski|skiing|snow|yoga|fitness|activewear|wiskii|gym|workout|sweat|sleep|spa|ayurveda|wellness|jungle|alpaca|penguin|waterfall|mountain|arctic|wild|nature|movement|strength|balance)\b/i],
  ['Luxury', /\b(hotel|resort|suite|igloo|lapland|finland|italy|rome|naples|phuket|thailand|travel|getaway|staycation|dining|restaurant|dinner|brunch|feast|burj|tower|penthouse|supercar|porsche|yacht|vodka|golden hour|metro station|sheraton|lana|fountain|khaleeji|vip|luxury|first class|jet)\b/i],
];
const classify = (c = '') => { for (const [cat, re] of RULES) if (re.test(c)) return cat; return 'Fashion'; };
function cardCaption(caption = '') {
  let s = caption.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#') && !l.startsWith('@')) || caption.split('\n')[0] || '';
  s = s.replace(/https?:\/\/\S+/g, '').replace(/[@#][\w.]+/g, '').replace(/\s+/g, ' ').trim();
  const cut = s.search(/[—•|]/);
  if (cut > 24) s = s.slice(0, cut);
  if (s.length > 72) s = s.slice(0, 71).replace(/\s+\S*$/, '') + '…';
  return s.trim();
}

export default async function handler() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) {
    return new Response(JSON.stringify({ error: 'No SUPABASE_SERVICE_KEY' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const select = 'permalink,caption,views,like_count,storage_thumbnail_url';
    const url = `${SUPABASE_URL}/rest/v1/instagram_posts?media_type=eq.VIDEO`
      + `&storage_thumbnail_url=not.is.null&views=not.is.null`
      + `&select=${select}&order=views.desc&limit=48`;
    const res = await fetch(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) throw new Error(`Supabase ${res.status}`);
    const rows = await res.json();

    const reels = rows.map(r => ({
      permalink: r.permalink,
      thumbnail: r.storage_thumbnail_url,
      caption: cardCaption(r.caption),
      category: classify(r.caption),
      views: r.views,
      likes: r.like_count ?? null,
    })).filter(r => r.permalink && r.thumbnail);

    return new Response(JSON.stringify({ generated_at: new Date().toISOString(), count: reels.length, reels }), {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
}

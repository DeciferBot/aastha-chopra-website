/**
 * Reels → data/reels.json
 * -----------------------------------------------------------------------------
 * Builds the homepage / world-page reels grid from the durable thumbnails that
 * the Instagram sync already pushed into Supabase Storage. Ranked by real views.
 *
 * Source of truth: instagram_posts (media_type=VIDEO) where storage_thumbnail_url
 * is populated — those are permanent public Supabase Storage URLs that never
 * expire, unlike the raw Instagram CDN links (which carry a short signature).
 *
 * Output: data/reels.json — committed, so the site renders instantly with zero
 * runtime API calls and never goes blank. Re-run after an ig-sync to refresh.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/sync-reels.mjs
 *   (SUPABASE_URL defaults to the project; LIMIT defaults to 48)
 */

import { writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local if present (does not override real env)
try {
  readFileSync(resolve(__dirname, '../.env.local'), 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=["']?(.+?)["']?\s*$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  });
} catch {}

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uqzvaytvynrglijvwjsz.supabase.co';
const KEY = process.env.SUPABASE_SERVICE_KEY;
const LIMIT = parseInt(process.env.REELS_LIMIT || '48', 10);
const RECENT_SLOTS = parseInt(process.env.REELS_RECENT || '6', 10);

if (!KEY) {
  console.error('Missing SUPABASE_SERVICE_KEY (env or .env.local). Aborting — reels.json left unchanged.');
  process.exit(1);
}

// ── Category classifier ───────────────────────────────────────────────────────
// Maps a reel to one of the homepage tabs. Deterministic keyword match, checked
// most-specific-first so beauty/wellness win over the broad fashion default.
const RULES = [
  ['Beauty', /\b(makeup|lip|lipstick|lip oil|lip liner|mascara|concealer|foundation|primer|blush|bronzer|highlighter|eyeshadow|skin|skincare|glow|serum|fragrance|perfume|parfum|scent|beauty|kosas|huda|maybelline|sephora|sephoria|charlotte tilbury|gisou|nars|elf|haircare|hair oil|fable\s*&?\s*mane|note cosmet|d&g|dolce.{0,3}gabbana beauty|rasasi|under.?eye)\b/i],
  ['Luxury', /\b(hotel|resort|suite|igloo|lapland|finland|italy|rome|naples|phuket|thailand|travel|getaway|staycation|dining|restaurant|dinner|brunch|feast|burj|tower|penthouse|supercar|porsche|yacht|vodka|golden hour|metro station|sheraton|lana|fountain|khaleeji|vip|luxury|first class|jet|london|paris|europe|castle|landmark|airport|flight|trip|vacation|holiday|abroad|ancient|historic|souvenir|passport|visiting|city break)\b/i],
  // Checked after Luxury: family/kids/health are broad, generic words that
  // should not steal a caption that already carries a specific Luxury signal
  // (e.g. "family at the Sheraton" is Luxury, not Wellness).
  ['Wellness', /\b(hike|hiking|ski|skiing|snow|yoga|fitness|activewear|wiskii|gym|workout|sweat|sleep|spa|ayurveda|wellness|jungle|alpaca|penguin|waterfall|mountain|arctic|wild|nature|movement|strength|balance|family|kids?|mask|vaccinated|vaccine|health|wellbeing|mental health)\b/i],
];
function classify(caption = '') {
  for (const [cat, re] of RULES) if (re.test(caption)) return cat;
  return 'Fashion';
}

// ── Caption → short, human card title ─────────────────────────────────────────
// Real text from the post: first meaningful line, hashtags/@handles/URLs stripped,
// trimmed to a clean length. Never invents copy.
function cardCaption(caption = '') {
  let s = caption.split('\n').map(l => l.trim()).find(l => l && !l.startsWith('#') && !l.startsWith('@')) || caption.split('\n')[0] || '';
  s = s
    .replace(/https?:\/\/\S+/g, '')
    .replace(/[@#][\w.]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  // Cut at sentence/emoji boundary, keep it short
  const cut = s.search(/(?<=[.!?])\s|[—•|]/);
  if (cut > 24) s = s.slice(0, cut);
  if (s.length > 72) s = s.slice(0, 71).replace(/\s+\S*$/, '') + '…';
  return s.trim();
}

async function main() {
  const select = 'permalink,caption,timestamp,views,like_count,comments_count,storage_thumbnail_url,storage_video_url';
  const base = `${SUPABASE_URL}/rest/v1/instagram_posts?media_type=eq.VIDEO`
    + `&storage_thumbnail_url=not.is.null`
    + `&select=${select}`;
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };

  // Mirrors /api/reels: the newest reels are always carried, because a fresh
  // reel's view count can't compete with a top-48 cut-off in the tens of
  // thousands and would otherwise never reach the site. RECENT_SLOTS = 0 gives
  // back a pure greatest-hits list.
  const [topRes, newRes] = await Promise.all([
    fetch(`${base}&views=not.is.null&order=views.desc&limit=${LIMIT}`, { headers }),
    fetch(`${base}&order=timestamp.desc.nullslast&limit=${RECENT_SLOTS}`, { headers }),
  ]);
  if (!topRes.ok) {
    console.error(`Supabase fetch failed: ${topRes.status} ${await topRes.text()}`);
    process.exit(1);
  }
  const top = await topRes.json();
  const recent = newRes.ok ? await newRes.json() : [];

  const seen = new Set();
  const rows = [...recent, ...top].filter(r => {
    if (!r.permalink || seen.has(r.permalink)) return false;
    seen.add(r.permalink);
    return true;
  });
  if (rows.length === 0) {
    console.error('No reels returned — leaving reels.json unchanged.');
    process.exit(1);
  }

  const sbImg = (url, w, q = 70) =>
    (typeof url === 'string' && url.includes('/storage/v1/object/public/'))
      ? `${url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/')}?width=${w}&quality=${q}&resize=contain`
      : url;

  const reels = rows.map(r => ({
    permalink: r.permalink,
    thumbnail: sbImg(r.storage_thumbnail_url, 720),
    caption: cardCaption(r.caption),
    category: classify(r.caption),
    media_url: r.storage_video_url || null,
    posted_at: r.timestamp || null,
    views: r.views,
    likes: r.like_count ?? null,
  })).filter(r => r.permalink && r.thumbnail);

  const out = {
    generated_at: new Date().toISOString(),
    source: `supabase:instagram_posts (storage_thumbnail_url; newest ${RECENT_SLOTS}, then ranked by views)`,
    count: reels.length,
    reels,
  };

  const dest = resolve(__dirname, '../data/reels.json');
  writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');

  const byCat = reels.reduce((a, r) => (a[r.category] = (a[r.category] || 0) + 1, a), {});
  console.log(`Wrote ${reels.length} reels → data/reels.json`);
  console.log('By category:', byCat);
}

main().catch(e => { console.error(e); process.exit(1); });

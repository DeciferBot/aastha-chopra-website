/**
 * Shared blog brain — layout, data access, and segment metadata used by the
 * public serving routes (blog, blog-index, sitemap) AND the generation cron,
 * so voice, chrome, and URL shape never drift between them.
 *
 * Underscore-prefixed so Vercel does NOT expose it as a route.
 *
 * The site itself is static HTML (index.html, fashion.html, ...). These blog
 * pages are rendered server-side but re-use the exact palette + type system
 * from css/world.css so they read as part of the same world, not bolted on.
 */

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';

export const SITE = {
  base:    'https://www.aasthachopra.com',
  name:    'Aastha Chopra',
  handle:  'aastha_sochic',
  ig:      'https://www.instagram.com/aastha_sochic/',
  ogImage: 'https://www.aasthachopra.com/images/og-image.jpg',
  blogPath: '/blog',
  // Aastha publishes from Dubai; dates render in her zone, not the server's.
  timeZone: 'Asia/Dubai',
};

// Author identity for E-E-A-T: connects every post to a credentialed real
// person. Facts are stable and verifiable (UAE Media Council licensed creator).
export const AUTHOR = {
  name: 'Aastha Chopra',
  url: `${SITE.base}/`,
  image: `${SITE.base}/images/aastha-chopra-dubai-luxury-fashion-beauty.jpg`,
  jobTitle: 'Lifestyle, Fashion and Beauty Creator',
  bio: 'Aastha is a Dubai based lifestyle, fashion and beauty creator and a UAE Media Council licensed creator. She writes from years of living, shopping and getting ready in the UAE, with more than 110 brand collaborations behind her.',
  // Keep in sync with the homepage Person sameAs (index.html #aastha) so the
  // same entity is declared consistently across every page Google crawls.
  sameAs: [
    'https://www.instagram.com/aastha_sochic/',
    'https://www.tiktok.com/@aastha_c8',
    'https://www.youtube.com/@aastha_sochic',
    'https://www.pinterest.com/aastha_sochic',
  ],
};

/**
 * The 9 brand pillars, mirrored from _pitch.js SEGMENT_ANGLES. Each maps to a
 * related landing page on the static site so every post links back into the
 * funnel, and carries a short hub blurb.
 */
export const SEGMENTS = {
  fashion:     { label: 'Fashion',     page: '/fashion.html', blurb: 'Styling real Dubai life, season by season.' },
  beauty:      { label: 'Beauty',      page: '/fashion.html', blurb: 'Honest, tested beauty for the Gulf climate.' },
  fragrance:   { label: 'Fragrance',   page: '/fashion.html', blurb: 'Scent as feeling, memory and occasion.' },
  jewellery:   { label: 'Jewellery',   page: '/luxury.html',  blurb: 'Pieces and the moments they are worn for.' },
  wellness:    { label: 'Wellness',    page: '/wellness.html', blurb: 'Believable routines that hold up in real life.' },
  hospitality: { label: 'Hospitality', page: '/luxury.html',  blurb: 'Stays and tables worth recreating.' },
  travel:      { label: 'Travel',      page: '/luxury.html',  blurb: 'Destinations built into a story you can plan.' },
  automobile:  { label: 'Automobile',  page: '/luxury.html',  blurb: 'The drive inside an aspirational life.' },
  retail:      { label: 'Retail',      page: '/fashion.html', blurb: 'Wide ranges made personal and shoppable.' },
};

export function segmentMeta(key) {
  return SEGMENTS[key] || { label: 'Journal', page: '/', blurb: '' };
}

/** On-brand local photography per pillar. A POOL (not one photo) per pillar so
 *  posts that don't yet have a linked Instagram image don't all collapse onto
 *  the same fallback — every card on a page can show a different, on-brand,
 *  segment-appropriate photo (absolute paths — the blog is served from /blog).
 *  The first entry stays the canonical pillar photo (used as the simple
 *  back-compat fallback and by hub cards). */
export const SEGMENT_POOL = {
  fashion: [
    '/images/aastha-chopra-fashion-editorial-dubai.jpg',
    '/images/aastha-chopra-dubai-fashion-creator-1.jpg',
    '/images/aastha-chopra-dubai-fashion-creator-2.jpg',
    '/images/aastha-chopra-dubai-fashion-luxury-1.jpg',
    '/images/aastha-chopra-evening-editorial-style.jpg',
    '/images/aastha-chopra-dubai-fashion-beauty-hero.jpg',
    '/images/aastha-chopra-dubai-lifestyle.jpg',
  ],
  beauty: [
    '/images/aastha-chopra-premium-beauty-dubai.jpg',
    '/images/aastha-chopra-mac-sephora-portrait.jpg',
    '/images/aastha-chopra-mac-sephora-event-1.jpg',
    '/images/aastha-chopra-mac-sephora-event-2.jpg',
    '/images/aastha-chopra-mac-sephora-launch.jpg',
    '/images/aastha-chopra-dubai-fashion-beauty-hero.jpg',
  ],
  fragrance: [
    '/images/aastha-chopra-evening-editorial-style.jpg',
    '/images/aastha-chopra-dubai-luxury-fashion-beauty.jpg',
    '/images/aastha-chopra-premium-beauty-dubai.jpg',
    '/images/aastha-chopra-mac-sephora-portrait.jpg',
  ],
  jewellery: [
    '/images/aastha-chopra-dubai-luxury-fashion-beauty.jpg',
    '/images/aastha-chopra-dubai-luxury-rooftop.jpg',
    '/images/aastha-chopra-dubai-fashion-luxury-1.jpg',
    '/images/aastha-chopra-evening-editorial-style.jpg',
  ],
  wellness: [
    '/images/aastha-chopra-dubai-wellness-fitness-hero.jpg',
    '/images/aastha-chopra-dubai-wellness.jpg',
    '/images/aastha-chopra-dubai-wellness-3.jpg',
    '/images/aastha-chopra-dubai-wellness-fitness-1.jpg',
    '/images/aastha-chopra-dubai-wellness-fitness-2.jpg',
    '/images/aastha-chopra-dubai-fitness.jpg',
    '/images/aastha-chopra-dubai-active-fitness.jpg',
  ],
  hospitality: [
    '/images/aastha-chopra-dubai-hotel-content.jpg',
    '/images/aastha-chopra-madinat-jumeirah-dubai.jpg',
    '/images/aastha-chopra-dubai-luxury-rooftop.jpg',
    '/images/aastha-chopra-dubai-lifestyle.jpg',
  ],
  travel: [
    '/images/aastha-chopra-dubai-luxury-travel-hero.jpg',
    '/images/aastha-chopra-dubai-travel.jpg',
    '/images/aastha-chopra-madinat-jumeirah-dubai.jpg',
    '/images/aastha-chopra-dubai-luxury-rooftop.jpg',
  ],
  automobile: [
    '/images/aastha-chopra-dubai-luxury-rooftop.jpg',
    '/images/aastha-chopra-dubai-luxury-fashion-beauty.jpg',
    '/images/aastha-chopra-dubai-lifestyle.jpg',
    '/images/aastha-chopra-dubai-creator-portrait.jpg',
  ],
  retail: [
    '/images/aastha-chopra-dubai-fashion.jpg',
    '/images/aastha-chopra-dubai-fashion-creator-1.jpg',
    '/images/aastha-chopra-dubai-fashion-creator-2.jpg',
    '/images/aastha-chopra-dubai-fashion-luxury-1.jpg',
    '/images/aastha-chopra-dubai-lifestyle.jpg',
  ],
};

/** Broad on-brand set used when a pillar pool is exhausted during de-duplication. */
const GLOBAL_POOL = [
  '/images/aastha-chopra-dubai-creator-portrait.jpg',
  '/images/aastha-chopra-dubai-lifestyle.jpg',
  '/images/aastha-chopra-dubai-fashion.jpg',
  '/images/aastha-chopra-fashion-editorial-dubai.jpg',
  '/images/aastha-chopra-dubai-luxury-fashion-beauty.jpg',
  '/images/aastha-chopra-premium-beauty-dubai.jpg',
  '/images/aastha-chopra-dubai-wellness.jpg',
  '/images/aastha-chopra-dubai-travel.jpg',
  '/images/aastha-chopra-dubai-hotel-content.jpg',
  '/images/aastha-chopra-evening-editorial-style.jpg',
  '/images/aastha-chopra-dubai-fashion-creator-1.jpg',
  '/images/aastha-chopra-dubai-fashion-creator-2.jpg',
  '/images/aastha-chopra-madinat-jumeirah-dubai.jpg',
  '/images/aastha-chopra-dubai-luxury-rooftop.jpg',
];

/** Back-compat: the single canonical photo per pillar (first of the pool). */
export const SEGMENT_IMG = Object.fromEntries(
  Object.entries(SEGMENT_POOL).map(([k, v]) => [k, v[0]])
);
export function segmentImage(key) {
  const pool = SEGMENT_POOL[key];
  return (pool && pool[0]) || '/images/aastha-chopra-dubai-creator-portrait.jpg';
}

/** Tiny stable string hash (FNV-ish) — same slug always maps the same way. */
function hashStr(s) {
  let h = 0;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) h = (Math.imul(h, 31) + str.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic per-post pick from its pillar pool, so posts without a linked
 *  Instagram image still spread across the pool instead of all sharing pool[0].
 *  Stable per slug (good for caching + OG). */
export function segmentImageFor(p) {
  const pool = SEGMENT_POOL[p && p.segment];
  if (!pool || !pool.length) return segmentImage(p && p.segment);
  return pool[hashStr(p && p.slug) % pool.length];
}

/** Resolve each post's image from the Instagram content it is linked to
 *  (instagram_refs → instagram_posts durable Supabase Storage URL), so every
 *  card/hero is unique and tied to the real piece. Batched + chunked; posts whose
 *  refs aren't synced yet fall back to the pillar photo via postImage(). Mutates
 *  posts in place (sets p._igImage) and returns them. */
export async function attachInstagramImages(posts) {
  const list = Array.isArray(posts) ? posts : [posts];
  const perPost = list.map((p) =>
    (Array.isArray(p && p.instagram_refs) ? p.instagram_refs : [])
      .map((r) => r && r.permalink)
      .filter(Boolean)
  );
  const all = [...new Set(perPost.flat())];
  if (!all.length) return posts;

  const map = {};
  const CHUNK = 40;
  for (let i = 0; i < all.length; i += CHUNK) {
    const value = `in.(${all.slice(i, i + CHUNK).map((u) => `"${String(u).replace(/"/g, '')}"`).join(',')})`;
    try {
      const rows = await sb(`/instagram_posts?select=permalink,storage_image_url,storage_thumbnail_url&permalink=${encodeURIComponent(value)}`);
      for (const r of rows || []) {
        const img = r.storage_image_url || r.storage_thumbnail_url;
        if (img && r.permalink && !map[r.permalink]) map[r.permalink] = img;
      }
    } catch {
      /* leave unresolved — postImage() falls back to the pillar photo */
    }
  }
  list.forEach((p, i) => {
    if (!p) return;
    // Per-ref image so renderInstagramBlock can show a thumbnail on each card…
    for (const r of (Array.isArray(p.instagram_refs) ? p.instagram_refs : [])) {
      if (r && r.permalink && map[r.permalink]) r._img = map[r.permalink];
    }
    // …and the post's primary image (first resolved ref) for cards/hero.
    for (const link of perPost[i]) {
      if (map[link]) { p._igImage = map[link]; break; }
    }
  });
  return posts;
}

/**
 * Editorial image overrides — an explicit, human-curated layer that wins over the
 * automatic resolver below. Use it when a published post's auto-picked image
 * (usually a linked Instagram reel) is topically wrong and we can't edit the DB
 * row quickly. `bySlug` pins one exact post; `byTopic` is a narrow self-healing
 * safety net so the right photo shows even if the published slug differs from the
 * guess, and so future posts on the same topic don't repeat the mistake.
 *
 * Example fixed here: the "best gyms in Dubai" wellness piece was rendering a
 * Finland ski-resort reel; both rules pin it to a real Dubai fitness photo.
 */
export const IMAGE_OVERRIDES = {
  bySlug: {
    'best-gyms-in-dubai': '/images/aastha-chopra-dubai-fitness.jpg',
    // On-brand healthy-Dubai-dining flatlay generated for this post (the repo has
    // no food photo). Egress policy blocked downloading it into /images from this
    // environment, so it is referenced from the generator CDN for now — replace
    // with a self-hosted /images/ copy when convenient for long-term durability.
    'healthy-food-in-dubai': 'https://d8j0ntlcm91z4.cloudfront.net/user_3F8jJ8z0wHCOBoiF5N79bKVkexP/hf_20260624_081152_efe1c1d6-8f85-4659-b439-0da6bd492d45.png',
  },
  byTopic: [
    { test: /\bgyms?\b/i, segment: 'wellness', img: '/images/aastha-chopra-dubai-fitness.jpg' },
  ],
};

/** Resolve an editorial override for a post, or '' if none applies. */
export function overrideImage(p) {
  if (!p) return '';
  if (p.slug && IMAGE_OVERRIDES.bySlug[p.slug]) return IMAGE_OVERRIDES.bySlug[p.slug];
  const title = String(p.title || '');
  for (const r of IMAGE_OVERRIDES.byTopic) {
    if (r.test.test(title) && (!r.segment || r.segment === p.segment)) return r.img;
  }
  return '';
}

/** The image a post would naturally show, ignoring any de-dup reassignment.
 *  Priority: editorial override → explicit hero → linked Instagram → pillar pool. */
function naturalImage(p) {
  return overrideImage(p) || (p && (p.hero_image_url || p._igImage)) || segmentImageFor(p);
}

/** Image priority: editorial override → de-dup reassignment → explicit hero →
 *  linked Instagram → pillar pool. (_dedupImg is only set on a page where the
 *  natural image collided with another post — see dedupePostImages.) */
export function postImage(p) {
  return overrideImage(p) || (p && p._dedupImg) || (p && (p.hero_image_url || p._igImage)) || segmentImageFor(p);
}

/** Guarantee every post in `posts` resolves to a DIFFERENT image on the page.
 *  Many posts fall back to a pillar photo (no synced IG image yet) and several
 *  can link the same reel, so without this the hub shows the same photo 3–4×
 *  per section. First occurrence keeps its natural image; later collisions are
 *  reassigned to an unused photo from the pillar pool (then a global pool).
 *  Mutates posts in place (sets p._dedupImg) and returns them. `seedUsed` lets
 *  callers reserve images already shown elsewhere on the page. */
export function dedupePostImages(posts, seedUsed) {
  const list = Array.isArray(posts) ? posts : [posts];
  const used = new Set(seedUsed || []);
  for (const p of list) {
    if (!p) continue;
    delete p._dedupImg;
    const img = naturalImage(p);
    if (!used.has(img)) { used.add(img); continue; }
    const pool = [...(SEGMENT_POOL[p.segment] || []), ...GLOBAL_POOL];
    const pick = pool.find((im) => !used.has(im));
    if (pick) { p._dedupImg = pick; used.add(pick); }
    else used.add(img); // every candidate already used — accept the repeat
  }
  return posts;
}

/** Serve Supabase Storage images resized via the on-the-fly transform endpoint
 *  (smaller + faster + WhatsApp-safe). Non-Supabase URLs (local /images, etc.)
 *  pass through untouched. */
export function sbImg(url, width, quality = 72) {
  if (!url || typeof url !== 'string' || !url.includes('/storage/v1/object/public/')) return url;
  const rendered = url.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/');
  return `${rendered}${rendered.includes('?') ? '&' : '?'}width=${width}&quality=${quality}&resize=contain`;
}

/** Supabase REST helper (service key, server-side only). */
export async function sb(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY;
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${await res.text()}`);
  // DELETE / 204 may have no body.
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);
}

/** Render the full HTML document with shared chrome around inner body markup. */
export function renderShell({ title, description, canonical, head = '', body, activeNav = '', wide = false }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${esc(canonical)}" />
  <meta name="theme-color" content="#080706" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
  <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
  <link rel="manifest" href="/site.webmanifest" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;1,300;1,400;1,500&family=Jost:wght@200;300;400;500&display=swap" rel="stylesheet" />
${head}
  <style>${BLOG_CSS}</style>
</head>
<body>
  <nav class="bnav">
    <a href="/" class="bnav-logo">Aastha</a>
    <ul class="bnav-links">
      <li><a href="/fashion.html"${activeNav === 'fashion' ? ' class="active"' : ''}>Fashion</a></li>
      <li><a href="/luxury.html"${activeNav === 'luxury' ? ' class="active"' : ''}>Luxury</a></li>
      <li><a href="/wellness.html"${activeNav === 'wellness' ? ' class="active"' : ''}>Wellness</a></li>
      <li><a href="/blog"${activeNav === 'blog' ? ' class="active"' : ''}>Journal</a></li>
    </ul>
    <a href="${SITE.ig}" class="bnav-cta" target="_blank" rel="noopener">Follow</a>
  </nav>
  <main class="bwrap${wide ? ' bwrap-wide' : ''}">
${body}
  </main>
  <footer class="bfoot">
    <div class="bfoot-logo">Aastha<span>.</span></div>
    <p>Dubai, UAE &nbsp;·&nbsp; <a href="${SITE.ig}" target="_blank" rel="noopener">@${SITE.handle}</a></p>
    <p class="bfoot-links">
      <a href="/">Home</a> &nbsp;·&nbsp;
      <a href="/blog">Journal</a> &nbsp;·&nbsp;
      <a href="/media-pack.html">Media Pack</a> &nbsp;·&nbsp;
      <a href="/privacy.html">Privacy</a>
    </p>
  </footer>
</body>
</html>`;
}

/** Reusable follow + newsletter conversion block. Posts to /api/subscribe. */
export function ctaBlock() {
  return `
    <aside class="bcta">
      <p class="bcta-kicker">The Edit</p>
      <h2>Style notes, Dubai finds and honest reviews, monthly.</h2>
      <p class="bcta-sub">No noise. Beauty, travel and wellness with intention, straight from Dubai.</p>
      <form class="bcta-form" onsubmit="return blogSubscribe(event)">
        <input type="email" name="email" placeholder="your@email.com" required aria-label="Email address" />
        <button type="submit">Join</button>
      </form>
      <p class="bcta-note" id="bcta-note"></p>
      <a class="bcta-ig" href="${SITE.ig}" target="_blank" rel="noopener">Or follow @${SITE.handle} on Instagram &rsaquo;</a>
    </aside>
    <script>
      function blogSubscribe(e){
        e.preventDefault();
        var f=e.target, note=document.getElementById('bcta-note');
        var email=f.email.value.trim();
        note.textContent='Joining...';
        fetch('/api/subscribe',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({email:email,eventId:'blog-'+Date.now()})})
          .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d};});})
          .then(function(x){note.textContent=x.ok?'You are on the list. Check your inbox.':(x.d.error||'Something went wrong.');if(x.ok)f.reset();})
          .catch(function(){note.textContent='Something went wrong. Please try again.';});
        return false;
      }
    </script>`;
}

/** Per-pillar branded hero. Decorative, on-brand, no external image needed. */
export function renderHeroSVG(segmentKey) {
  const seg = segmentMeta(segmentKey);
  const idx = Object.keys(SEGMENTS).indexOf(segmentKey);
  const cx = 22 + ((idx * 9) % 56); // shift the glow per pillar for variety
  const id = `bh${idx < 0 ? 0 : idx}`;
  const label = seg.label;
  return `<svg class="bhero-svg" viewBox="0 0 1200 360" role="img" aria-label="${esc(label)}" preserveAspectRatio="xMidYMid slice">
    <defs>
      <radialGradient id="${id}" cx="${cx}%" cy="26%" r="78%">
        <stop offset="0%" stop-color="#C4983A" stop-opacity="0.30"/>
        <stop offset="52%" stop-color="#8B3020" stop-opacity="0.12"/>
        <stop offset="100%" stop-color="#080706" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="360" fill="#0b0908"/>
    <rect width="1200" height="360" fill="url(#${id})"/>
    <text x="56" y="252" font-family="'Cormorant Garamond',Georgia,serif" font-style="italic" font-size="232" fill="#C4983A" fill-opacity="0.07">${esc(label)}</text>
    <rect x="60" y="296" width="84" height="2" fill="#C4983A"/>
    <text x="60" y="332" font-family="'Jost',sans-serif" font-size="17" letter-spacing="6" fill="#C4983A" fill-opacity="0.85">${esc(label.toUpperCase())}</text>
  </svg>`;
}

/**
 * Publish date for a card or feature, as both a machine value and a readable
 * label. Returns null when a post carries no usable date, so callers omit the
 * element instead of printing "Invalid Date".
 */
export function postDateParts(p) {
  const raw = p && (p.published_at || p.created_at);
  if (!raw) return null;
  const s = String(raw).trim();
  let d = new Date(s);
  if (Number.isNaN(d.getTime())) {
    // Postgres renders timestamptz as "2026-07-05 10:11:38.671413+00" — a space
    // separator and a two-digit offset, neither of which Date parses. PostgREST
    // normally hands us proper ISO, but tolerate the raw form so a date never
    // silently vanishes from a card.
    d = new Date(s.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00'));
  }
  if (Number.isNaN(d.getTime())) return null;
  // Both values are pinned to Dubai time. Left to the runtime they would
  // disagree: the label would follow the server zone (UTC on Vercel, +04 in
  // local dev) while an ISO slice is always UTC, so anything published after
  // 20:00 UTC showed one day in the text and another in the datetime attribute.
  // en-CA formats as YYYY-MM-DD, which is exactly the datetime attribute form.
  return {
    iso: new Intl.DateTimeFormat('en-CA', {
      timeZone: SITE.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(d),
    label: new Intl.DateTimeFormat('en-GB', {
      timeZone: SITE.timeZone, day: 'numeric', month: 'long', year: 'numeric',
    }).format(d),
  };
}

/** Reusable post card, used by the Journal home and by related-post blocks. */
export function renderPostCard(p) {
  const seg = segmentMeta(p.segment);
  const dek = p.excerpt || p.meta_description || '';
  const short = dek.length > 130 ? dek.slice(0, 130).trim() + '…' : dek;
  const img = sbImg(postImage(p), 720);
  const date = postDateParts(p);
  const dateHtml = date
    ? `\n          <time class="bcard-date" datetime="${esc(date.iso)}">${esc(date.label)}</time>`
    : '';
  return `<a class="bcard" href="/blog/${esc(p.slug)}">
        <div class="bcard-media" style="--img:url('${esc(img)}')"><img src="${esc(img)}" alt="${esc(p.title)}" loading="lazy" /></div>
        <div class="bcard-body">
          <span class="seg">${esc(seg.label)}</span>
          <h3>${esc(p.title)}</h3>
          <p>${esc(short)}</p>${dateHtml}
        </div>
      </a>`;
}

/** Author bio box for E-E-A-T, shown at the foot of every post. */
export function renderAuthorBox() {
  return `
    <aside class="bauthor">
      <img class="bauthor-img" src="${esc(AUTHOR.image)}" alt="${esc(AUTHOR.name)}" loading="lazy" width="72" height="72" />
      <div class="bauthor-body">
        <p class="bauthor-kicker">Written by</p>
        <p class="bauthor-name">${esc(AUTHOR.name)}</p>
        <p class="bauthor-role">${esc(AUTHOR.jobTitle)}</p>
        <p class="bauthor-bio">${esc(AUTHOR.bio)}</p>
        <a class="bauthor-follow" href="${SITE.ig}" target="_blank" rel="noopener">Follow @${SITE.handle} &rsaquo;</a>
      </div>
    </aside>`;
}

/** "As seen on my Instagram" block: links a post to Aastha's real reels. */
export function renderInstagramBlock(refs) {
  if (!Array.isArray(refs) || !refs.length) return '';
  const cards = refs.slice(0, 3).map((r) => {
    if (!r || !r.permalink) return '';
    const isReel = String(r.type || '').toLowerCase() === 'reel' || /\/reel\//.test(r.permalink);
    const cap = esc(String(r.caption || '').replace(/\s+/g, ' ').slice(0, 150));
    const imgUrl = r._img ? sbImg(r._img, 480) : '';
    const thumb = imgUrl
      ? `<span class="bigram-thumb"><img src="${esc(imgUrl)}" alt="${cap || (isReel ? 'Reel' : 'Post')}" loading="lazy" />${isReel ? '<span class="bigram-play">&#9658;</span>' : ''}</span>`
      : '';
    return `<a class="bigram-card${imgUrl ? ' has-thumb' : ''}" href="${esc(r.permalink)}" target="_blank" rel="noopener">
        ${thumb}
        <span class="bigram-body">
          <span class="bigram-badge">${isReel ? '&#9658;&nbsp;Reel' : 'Post'}</span>
          <span class="bigram-cap">${cap}</span>
          <span class="bigram-cta">Watch on Instagram &rsaquo;</span>
        </span>
      </a>`;
  }).filter(Boolean).join('\n      ');
  if (!cards) return '';
  return `
    <aside class="binsta">
      <p class="binsta-head">As seen on my Instagram</p>
      <div class="binsta-grid">
      ${cards}
      </div>
    </aside>`;
}

/** Person entity for JSON-LD. Referenced by Article author and listed in @graph. */
export function personSchema() {
  return {
    '@type': 'Person',
    '@id': `${SITE.base}/#aastha`,
    name: AUTHOR.name,
    url: AUTHOR.url,
    image: AUTHOR.image,
    jobTitle: AUTHOR.jobTitle,
    description: AUTHOR.bio,
    sameAs: AUTHOR.sameAs,
  };
}

const BLOG_CSS = `
  :root{
    --bg:#080706;--bg-raised:#0f0d0b;--bg-card:#131109;
    --gold:#C4983A;--gold-light:#D4B87A;--gold-dim:rgba(196,152,58,0.12);
    --text:#F4ECD8;--text-mid:#B0A18C;--text-dim:#8B7E6D;--text-on-gold:#080706;
    --border:rgba(196,152,58,0.14);--border-hi:rgba(196,152,58,0.34);
    --serif:'Cormorant Garamond',Georgia,serif;--sans:'Jost','Helvetica Neue',sans-serif;
    --ease-out:cubic-bezier(0.23,1,0.32,1);
  }
  *{box-sizing:border-box;margin:0;padding:0;}
  body{background:var(--bg);color:var(--text);font-family:var(--sans);font-weight:300;line-height:1.75;-webkit-font-smoothing:antialiased;}
  a{color:var(--gold);text-decoration:none;transition:color .2s;}
  a:hover{color:var(--gold-light);}
  .bnav{position:sticky;top:0;z-index:50;display:flex;align-items:center;gap:28px;padding:18px 28px;
    background:rgba(8,7,6,0.94);backdrop-filter:blur(10px);border-bottom:1px solid var(--border);}
  .bnav-logo{font-family:var(--serif);font-size:1.3rem;color:var(--text);letter-spacing:.04em;}
  .bnav-logo::after{content:'.';color:var(--gold);}
  .bnav-links{list-style:none;display:flex;gap:22px;margin-left:auto;}
  .bnav-links a{font-size:.66rem;letter-spacing:.22em;text-transform:uppercase;color:var(--text-mid);}
  .bnav-links a:hover,.bnav-links a.active{color:var(--gold);}
  .bnav-cta{font-size:.66rem;letter-spacing:.22em;text-transform:uppercase;color:var(--text-on-gold);
    background:var(--gold);padding:9px 20px;}
  .bnav-cta:hover{color:var(--text-on-gold);opacity:.9;}
  .bwrap{max-width:720px;margin:0 auto;padding:64px 24px 24px;}
  .bwrap-wide{max-width:1200px;padding-left:40px;padding-right:40px;}
  @media(max-width:600px){.bnav-links{display:none;}.bwrap{padding-top:44px;}.bwrap-wide{padding-left:20px;padding-right:20px;}}

  .bkicker{font-size:.68rem;letter-spacing:.26em;text-transform:uppercase;color:var(--gold);margin-bottom:18px;}
  .bcrumb{font-size:.66rem;letter-spacing:.1em;color:var(--text-dim);margin-bottom:22px;}
  .bcrumb a{color:var(--text-mid);}
  article h1{font-family:var(--serif);font-weight:400;font-size:clamp(2rem,5vw,3rem);line-height:1.12;letter-spacing:.005em;margin-bottom:20px;}
  .bdek{font-size:1.12rem;color:var(--text);line-height:1.7;padding:18px 22px;margin:0 0 12px;
    background:var(--bg-card);border-left:2px solid var(--gold);}
  .bmeta{font-size:.66rem;letter-spacing:.14em;text-transform:uppercase;color:var(--text-dim);margin:18px 0 40px;}
  article h2{font-family:var(--serif);font-weight:500;font-size:1.7rem;line-height:1.25;margin:48px 0 16px;color:var(--gold-light);}
  article h3{font-family:var(--serif);font-weight:500;font-size:1.3rem;margin:32px 0 12px;}
  article p{margin:0 0 20px;color:#E6DCC4;}
  article ul,article ol{margin:0 0 22px;padding-left:24px;color:#E6DCC4;}
  article li{margin-bottom:10px;}
  article a{border-bottom:1px solid var(--border-hi);}
  article blockquote{margin:28px 0;padding:4px 22px;border-left:2px solid var(--border-hi);
    font-family:var(--serif);font-size:1.3rem;font-style:italic;color:var(--text);}
  article table{width:100%;border-collapse:collapse;margin:24px 0;font-size:.92rem;}
  article th,article td{text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);}
  article th{color:var(--gold);text-transform:uppercase;font-size:.66rem;letter-spacing:.14em;}
  /* Reels are native 9:16 — too tall to show whole. Crop to a 4/5 portrait
     (capped to the viewport), anchored to the top so faces stay in frame. */
  .bhero{position:relative;width:100%;aspect-ratio:4/5;max-height:80vh;overflow:hidden;margin:0 0 32px;border:1px solid var(--border);background:var(--bg-raised);}
  .bhero::before{content:'';position:absolute;inset:0;background:var(--img) center/cover no-repeat;filter:blur(34px) brightness(.45) saturate(1.05);transform:scale(1.18);}
  .bhero img{position:relative;width:100%;height:100%;object-fit:cover;object-position:center top;display:block;}

  .bfaq{margin:56px 0 0;border-top:1px solid var(--border);padding-top:8px;}
  .bfaq h2{font-size:1.5rem;}
  .bfaq details{border-bottom:1px solid var(--border);padding:16px 0;}
  .bfaq summary{cursor:pointer;font-family:var(--serif);font-size:1.2rem;color:var(--text);list-style:none;}
  .bfaq summary::-webkit-details-marker{display:none;}
  .bfaq summary::before{content:'+';color:var(--gold);margin-right:12px;}
  .bfaq details[open] summary::before{content:'\\2013';}
  .bfaq p{margin-top:12px;color:var(--text-mid);}

  .bsources{margin:48px 0 0;font-size:.82rem;color:var(--text-dim);}
  .bsources h2{font-size:1rem;font-family:var(--sans);letter-spacing:.18em;text-transform:uppercase;color:var(--text-mid);margin-bottom:12px;}
  .bsources li{margin-bottom:6px;word-break:break-word;}

  .bcta{margin:64px 0 0;padding:40px 32px;background:linear-gradient(135deg,var(--bg-card),var(--bg-raised));
    border:1px solid var(--border);text-align:center;}
  .bcta-kicker{font-size:.66rem;letter-spacing:.26em;text-transform:uppercase;color:var(--gold);margin-bottom:14px;}
  .bcta h2{font-family:var(--serif);font-weight:400;font-size:1.7rem;line-height:1.2;margin-bottom:12px;}
  .bcta-sub{color:var(--text-mid);margin-bottom:24px;}
  .bcta-form{display:flex;gap:10px;max-width:420px;margin:0 auto;}
  .bcta-form input{flex:1;background:var(--bg);border:1px solid var(--border-hi);color:var(--text);
    padding:12px 14px;font-family:var(--sans);font-size:.9rem;}
  .bcta-form button{background:var(--gold);color:var(--text-on-gold);border:none;padding:12px 24px;
    font-family:var(--sans);font-size:.7rem;letter-spacing:.18em;text-transform:uppercase;cursor:pointer;}
  .bcta-note{min-height:18px;margin-top:12px;font-size:.8rem;color:var(--gold-light);}
  .bcta-ig{display:inline-block;margin-top:8px;font-size:.78rem;letter-spacing:.1em;color:var(--text-mid);}

  .bgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:24px;margin-top:30px;}
  /* On the wide hub (home + pillar pages) lock to a clean 3-up, stepping down
     gracefully; the narrower single-post container keeps the auto-fill above. */
  .bwrap-wide .bgrid{grid-template-columns:repeat(3,minmax(0,1fr));gap:28px;}
  @media(max-width:920px){.bwrap-wide .bgrid{grid-template-columns:repeat(2,minmax(0,1fr));gap:22px;}}
  @media(max-width:560px){.bwrap-wide .bgrid{grid-template-columns:1fr;}}
  .bcard{display:flex;flex-direction:column;overflow:hidden;background:var(--bg-card);border:1px solid var(--border);transition:border-color .25s var(--ease-out),transform .25s var(--ease-out),box-shadow .25s var(--ease-out);}
  .bcard:hover{border-color:var(--border-hi);transform:translateY(-3px);box-shadow:var(--shadow,0 16px 50px rgba(0,0,0,.5));}
  /* Reels are native 9:16 — too tall to show whole in a tidy grid. Crop each to
     a consistent 4/5 portrait, anchored to the top so faces/subjects stay. */
  .bcard-media{position:relative;aspect-ratio:4/5;overflow:hidden;background:var(--bg-raised);}
  .bcard-media img{width:100%;height:100%;object-fit:cover;object-position:center top;display:block;transition:transform .6s var(--ease-out);}
  .bcard-body{padding:20px 22px 24px;display:flex;flex-direction:column;flex:1;}
  .bcard .seg{font-size:.6rem;letter-spacing:.24em;text-transform:uppercase;color:var(--gold);}
  .bcard h3{font-family:var(--serif);font-weight:400;font-size:1.4rem;line-height:1.22;margin:9px 0 9px;color:var(--text);}
  .bcard p{font-size:.9rem;color:var(--text-mid);line-height:1.6;}
  /* margin-top:auto pins the date to the foot of the card so a row of cards
     with uneven excerpt lengths still lines its dates up. */
  .bcard-date{margin-top:auto;padding-top:14px;font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:var(--text-dim);}
  .bfeature-date{display:block;margin-top:16px;font-size:.62rem;letter-spacing:.18em;text-transform:uppercase;color:var(--text-dim);}
  @media(hover:hover) and (pointer:fine){.bcard:hover .bcard-media img{transform:scale(1.05);}}
  .bhubhead{text-align:center;margin-bottom:8px;}
  .bhubhead h1{font-family:var(--serif);font-weight:400;font-size:clamp(2.2rem,6vw,3.4rem);}
  .bhubhead p{color:var(--text-mid);max-width:560px;margin:14px auto 0;}
  .bempty{text-align:center;color:var(--text-dim);padding:60px 0;font-style:italic;font-family:var(--serif);font-size:1.2rem;}

  .bfoot{max-width:720px;margin:80px auto 0;padding:40px 24px 56px;border-top:1px solid var(--border);text-align:center;color:var(--text-dim);font-size:.78rem;}
  .bfoot-logo{font-family:var(--serif);font-size:1.2rem;color:var(--text-mid);margin-bottom:14px;}
  .bfoot-logo span{color:var(--gold);}
  .bfoot p{margin-bottom:8px;}
  .bfoot-links a{color:var(--text-mid);}

  .bhero-svg{width:100%;height:auto;display:block;margin:0 0 34px;border:1px solid var(--border);}

  .bauthor{display:flex;gap:18px;align-items:flex-start;margin:48px 0 0;padding:26px 24px;
    background:var(--bg-card);border:1px solid var(--border);}
  .bauthor-img{width:72px;height:72px;border-radius:50%;object-fit:cover;flex:none;border:1px solid var(--border-hi);}
  .bauthor-kicker{font-size:.6rem;letter-spacing:.24em;text-transform:uppercase;color:var(--text-dim);margin-bottom:4px;}
  .bauthor-name{font-family:var(--serif);font-size:1.4rem;color:var(--text);line-height:1.1;}
  .bauthor-role{font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;color:var(--gold);margin:4px 0 10px;}
  .bauthor-bio{font-size:.92rem;color:var(--text-mid);margin-bottom:10px;}
  .bauthor-follow{font-size:.78rem;letter-spacing:.08em;color:var(--gold);}
  @media(max-width:520px){.bauthor{flex-direction:column;gap:14px;}}

  .brelated{margin:56px 0 0;border-top:1px solid var(--border);padding-top:8px;}
  .brelated h2{font-family:var(--serif);font-weight:500;font-size:1.5rem;color:var(--gold-light);margin:16px 0 18px;}

  .bfilter{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin:32px 0 8px;}
  .bfilter a{font-size:.64rem;letter-spacing:.18em;text-transform:uppercase;color:var(--text-mid);
    border:1px solid var(--border);padding:7px 14px;transition:border-color .2s,color .2s;}
  .bfilter a:hover{color:var(--gold);border-color:var(--border-hi);}
  .bfilter a.active{color:var(--text-on-gold);background:var(--gold);border-color:var(--gold);}
  .bsection{margin-top:48px;}
  .bsection-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;
    border-bottom:1px solid var(--border);padding-bottom:10px;margin-bottom:22px;}
  .bsection-head h2{font-family:var(--serif);font-weight:500;font-size:1.6rem;color:var(--text);}
  .bsection-head a{font-size:.64rem;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);}
  .bfeature{display:grid;grid-template-columns:0.85fr 1.15fr;margin-top:36px;overflow:hidden;
    background:linear-gradient(135deg,var(--bg-card),var(--bg-raised));
    border:1px solid var(--border-hi);transition:transform .25s var(--ease-out),box-shadow .25s var(--ease-out);}
  .bfeature:hover{transform:translateY(-2px);box-shadow:0 20px 60px rgba(0,0,0,.5);}
  /* Portrait 4/5 frame so the (usually vertical) lead image sits almost full. */
  .bfeature-media{position:relative;aspect-ratio:4/5;overflow:hidden;background:var(--bg-raised);}
  .bfeature-media::before{content:'';position:absolute;inset:0;background:var(--img) center/cover no-repeat;filter:blur(34px) brightness(.45) saturate(1.05);transform:scale(1.18);}
  .bfeature-media img{position:relative;width:100%;height:100%;object-fit:cover;object-position:center top;display:block;transition:transform .7s var(--ease-out);}
  .bfeature-body{padding:52px 52px;display:flex;flex-direction:column;justify-content:center;}
  .bfeature .seg{font-size:.64rem;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);}
  .bfeature h2{font-family:var(--serif);font-weight:400;font-size:clamp(2.1rem,3.8vw,3.1rem);line-height:1.1;margin:14px 0;color:var(--text);}
  .bfeature p{color:var(--text-mid);max-width:50ch;line-height:1.65;}
  .bfeature-cta{margin-top:20px;font-size:.66rem;letter-spacing:.2em;text-transform:uppercase;color:var(--gold);}
  @media(hover:hover) and (pointer:fine){.bfeature:hover .bfeature-media img{transform:scale(1.04);}}
  @media(max-width:680px){.bfeature{grid-template-columns:1fr;}.bfeature-media{aspect-ratio:4/5;}.bfeature-body{padding:32px 26px;}}

  .binsta{margin:40px 0 0;padding:24px;background:var(--bg-card);border:1px solid var(--border);}
  .binsta-head{font-size:.66rem;letter-spacing:.24em;text-transform:uppercase;color:var(--gold);margin-bottom:16px;}
  .binsta-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;}
  .bigram-card{display:flex;flex-direction:column;background:var(--bg);border:1px solid var(--border);overflow:hidden;transition:border-color .2s,transform .2s;}
  .bigram-card:hover{border-color:var(--border-hi);transform:translateY(-2px);}
  .bigram-thumb{position:relative;display:block;aspect-ratio:4/5;overflow:hidden;background:#0c0a08;}
  .bigram-thumb img{width:100%;height:100%;object-fit:cover;object-position:center;display:block;transition:transform .5s ease;}
  .bigram-card:hover .bigram-thumb img{transform:scale(1.05);}
  .bigram-play{position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:44px;height:44px;border-radius:50%;background:rgba(196,152,58,0.92);color:#080706;display:flex;align-items:center;justify-content:center;font-size:15px;padding-left:3px;opacity:.92;transition:transform .25s,opacity .25s;}
  .bigram-card:hover .bigram-play{transform:translate(-50%,-50%) scale(1.08);opacity:1;}
  .bigram-body{display:flex;flex-direction:column;gap:8px;padding:16px;}
  .bigram-card:not(.has-thumb) .bigram-body{min-height:120px;}
  .bigram-badge{font-size:.6rem;letter-spacing:.18em;text-transform:uppercase;color:var(--gold);}
  .bigram-cap{font-size:.95rem;color:var(--text);line-height:1.5;font-style:italic;font-family:var(--serif);}
  .bigram-cta{font-size:.72rem;letter-spacing:.08em;color:var(--text-mid);margin-top:auto;}
  .bigram-card:hover .bigram-cta{color:var(--gold);}

  /* ── Motion & focus — strong ease-out, press feedback, reduced-motion safe ── */
  :focus-visible{outline:2px solid var(--gold);outline-offset:3px;border-radius:2px;}
  :focus:not(:focus-visible){outline:none;}
  .bnav-cta,.bcta-submit,.bcard,.bfeature,.bigram-card,.bfilter a,.bcrumb a,.bcard h3{
    transition:transform .22s var(--ease-out),border-color .22s var(--ease-out),color .2s ease,background .2s ease;}
  .bnav-cta:active,.bcta-submit:active{transform:scale(.97);}
  @media (hover:hover) and (pointer:fine){
    .bcard:hover,.bigram-card:hover{transform:translateY(-3px);}
    .bfeature:hover{transform:translateY(-2px);}
    .bnav-cta:hover{transform:translateY(-1px);}
    .bcard:hover h3{color:var(--gold-light);}
  }
  @keyframes brise{from{opacity:0;transform:translateY(12px);}to{opacity:1;transform:none;}}
  article,.bhubhead,.bfeature,.bfilter{animation:brise .55s var(--ease-out) both;}
  .bgrid .bcard{animation:brise .5s var(--ease-out) both;}
  .bgrid .bcard:nth-child(2){animation-delay:.05s;}
  .bgrid .bcard:nth-child(3){animation-delay:.1s;}
  .bgrid .bcard:nth-child(4){animation-delay:.15s;}
  .bgrid .bcard:nth-child(5){animation-delay:.2s;}
  .bgrid .bcard:nth-child(6){animation-delay:.25s;}
  @media (prefers-reduced-motion: reduce){
    *,*::before,*::after{animation:none!important;transition:none!important;}
  }
`;

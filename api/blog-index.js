/**
 * Journal home — GET /blog  (rewritten to /api/blog-index), optional ?segment=fragrance
 *
 * Home view: a pillar filter bar, a featured latest piece, then posts grouped
 * into pillar sections so it stays navigable as articles accumulate.
 * Segment view: a flat archive of that pillar. Emits Blog + Person JSON-LD.
 */

import { SITE, sb, esc, renderShell, segmentMeta, SEGMENTS, JOURNAL_SEGMENTS, pillarFirst, renderPicture, renderPostCard, personSchema, organizationSchema, postImage, attachInstagramImages, dedupePostImages, sbImg, postDateParts } from './_blog.js';

// Pillars shown to readers. Hidden pillars (automobile) never get a section or a
// filter chip; a ?segment= for one of them falls back to the full Journal.
const SEG_KEYS = JOURNAL_SEGMENTS;

export default async function handler(req, res) {
  const segment = String(req.query.segment || '').toLowerCase().replace(/[^a-z]/g, '');
  const filtered = segment && SEGMENTS[segment] && !SEGMENTS[segment].hidden ? segment : '';

  let posts = [];
  try {
    let path = '/blog_posts?select=slug,segment,title,excerpt,meta_description,published_at,created_at,instagram_refs,hero_image_url'
      + '&status=eq.published&order=published_at.desc.nullslast,created_at.desc&limit=120';
    if (filtered) path += `&segment=eq.${filtered}`;
    posts = (await sb(path)) || [];
    await attachInstagramImages(posts);
    // Posts render in this order (featured = posts[0], then pillar sections are
    // subsets in order), so de-duping the whole list guarantees no repeated
    // photo on the page — including within each section.
    dedupePostImages(posts);
  } catch {
    posts = [];
  }

  const heading = filtered ? segmentMeta(filtered).label : 'The Journal';
  const sub = filtered
    ? segmentMeta(filtered).blurb
    : 'Straight answers to the questions people actually ask about living in Dubai: what to wear, what works on your skin here, where to buy gold and perfume, where to eat, rest and escape. Written from experience, not brochures.';
  const url = filtered ? `${SITE.base}/blog?segment=${filtered}` : `${SITE.base}/blog`;

  const body = filtered
    ? renderSegmentView({ filtered, heading, posts })
    : renderHomeView({ heading, sub, posts });

  const blogLd = {
    '@type': 'Blog',
    '@id': `${SITE.base}/blog#blog`,
    name: `${SITE.name} — Journal`,
    description: sub,
    url: `${SITE.base}/blog`,
    inLanguage: 'en-AE',
    isPartOf: { '@id': `${SITE.base}/#website` },
    author: { '@id': `${SITE.base}/#aastha` },
    publisher: { '@id': `${SITE.base}/#organization` },
    blogPost: posts.slice(0, 20).map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      url: `${SITE.base}/blog/${p.slug}`,
      datePublished: p.published_at || p.created_at,
    })),
  };

  // A CollectionPage with an explicit ItemList tells Google this is a hub and
  // gives it the order the guides are actually presented in.
  const collectionLd = {
    '@type': 'CollectionPage',
    '@id': `${url}#collection`,
    url,
    name: `${heading} | ${SITE.name}`,
    description: sub,
    inLanguage: 'en-AE',
    isPartOf: { '@id': `${SITE.base}/#website` },
    about: { '@id': `${SITE.base}/#aastha` },
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: posts.length,
      itemListElement: posts.slice(0, 30).map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${SITE.base}/blog/${p.slug}`,
        name: p.title,
      })),
    },
  };

  const crumbs = [
    { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE.base}/` },
    { '@type': 'ListItem', position: 2, name: 'Journal', item: `${SITE.base}/blog` },
  ];
  if (filtered) crumbs.push({ '@type': 'ListItem', position: 3, name: heading, item: url });

  const websiteLd = {
    '@type': 'WebSite',
    '@id': `${SITE.base}/#website`,
    url: SITE.base,
    name: SITE.name,
    inLanguage: 'en-AE',
    publisher: { '@id': `${SITE.base}/#organization` },
  };

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [personSchema(), organizationSchema(), websiteLd, blogLd, collectionLd,
      { '@type': 'BreadcrumbList', itemListElement: crumbs }],
  };

  const ogRaw = posts.length ? postImage(posts[0]) : SITE.ogImage;
  const ogImg = sbImg(ogRaw.startsWith('http') ? ogRaw : `${SITE.base}${ogRaw}`, 1200);
  const head = `  <meta property="og:type" content="website" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:title" content="${esc(heading)} | Aastha Chopra" />
  <meta property="og:description" content="${esc(sub)}" />
  <meta property="og:image" content="${esc(ogImg)}" />
  <meta property="og:locale" content="en_AE" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(heading)} | Aastha Chopra" />
  <meta name="twitter:description" content="${esc(sub)}" />
  <meta name="twitter:image" content="${esc(ogImg)}" />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=86400');
  return res.status(200).send(renderShell({
    title: `${heading} | Aastha Chopra`,
    description: sub,
    canonical: url,
    head,
    body,
    activeNav: 'blog',
    wide: true,
  }));
}

/** Pillar filter bar; only shows pillars that actually have posts (plus All). */
function filterBar(active, availableSegments) {
  const chips = [`<a href="/blog"${!active ? ' class="active"' : ''}>All</a>`];
  for (const key of SEG_KEYS) {
    if (!availableSegments.has(key)) continue;
    const cls = active === key ? ' class="active"' : '';
    chips.push(`<a href="/blog?segment=${key}"${cls}>${esc(segmentMeta(key).label)}</a>`);
  }
  return `<nav class="bfilter">${chips.join('')}</nav>`;
}

function renderHomeView({ heading, sub, posts }) {
  if (!posts.length) {
    return `
    <div class="bhubhead">
      <p class="bkicker" style="text-align:center;">Dubai, UAE</p>
      <h1>${esc(heading)}</h1>
      <p>${esc(sub)}</p>
    </div>
    <div class="bempty">New stories are on the way. Check back soon.</div>`;
  }

  const available = new Set(posts.map((p) => p.segment));
  const featured = posts[0];
  const fseg = segmentMeta(featured.segment);
  const fimg = sbImg(postImage(featured), 1000);
  const fdate = postDateParts(featured);
  const featuredHtml = `
    <a class="bfeature" href="/blog/${esc(featured.slug)}">
      <div class="bfeature-media" style="--img:url('${esc(fimg)}')">${renderPicture({ src: fimg, alt: featured.title, eager: true })}</div>
      <div class="bfeature-body">
        <span class="seg">${esc(fseg.label)} &nbsp;·&nbsp; Latest</span>
        <h2>${esc(featured.title)}</h2>
        <p>${esc((featured.excerpt || featured.meta_description || '').slice(0, 180))}</p>
        ${fdate ? `<time class="bfeature-date" datetime="${esc(fdate.iso)}">${esc(fdate.label)}</time>` : ''}
        <span class="bfeature-cta">Read the story &rsaquo;</span>
      </div>
    </a>`;

  // Group the remaining posts by pillar, in pillar order, skipping empties.
  const rest = posts.slice(1);
  const bySeg = new Map();
  for (const p of rest) {
    if (!bySeg.has(p.segment)) bySeg.set(p.segment, []);
    bySeg.get(p.segment).push(p);
  }
  const sections = SEG_KEYS
    .filter((key) => bySeg.has(key))
    .map((key) => {
      const seg = segmentMeta(key);
      const items = pillarFirst(bySeg.get(key)).slice(0, 4);
      return `
    <section class="bsection">
      <div class="bsection-head">
        <h2>${esc(seg.label)}</h2>
        <a href="/blog?segment=${key}">View all &rsaquo;</a>
      </div>
      <div class="bgrid">
      ${items.map(renderPostCard).join('\n      ')}
      </div>
    </section>`;
    }).join('\n');

  return `
    <div class="bhubhead">
      <p class="bkicker" style="text-align:center;">Dubai, UAE</p>
      <h1>${esc(heading)}</h1>
      <p>${esc(sub)}</p>
    </div>
    ${filterBar('', available)}
    ${featuredHtml}
    ${sections}`;
}

function renderSegmentView({ filtered, heading, posts }) {
  // On a pillar page, offer the full pillar set; bar shows all pillars with posts.
  const available = new Set(SEG_KEYS); // bar links stay useful even if a pillar is briefly empty
  const grid = posts.length
    ? `<div class="bgrid">\n      ${pillarFirst(posts).map(renderPostCard).join('\n      ')}\n    </div>`
    : `<div class="bempty">No ${esc(heading.toLowerCase())} stories yet. More are on the way.</div>`;
  return `
    <div class="bhubhead">
      <p class="bkicker" style="text-align:center;">${esc(heading)}</p>
      <h1>${esc(heading)}</h1>
      <p>${esc(segmentMeta(filtered).blurb)}</p>
    </div>
    ${filterBar(filtered, available)}
    <div class="bsection">${grid}</div>`;
}

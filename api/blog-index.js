/**
 * Blog hub — GET /blog  (rewritten to /api/blog-index), optional ?segment=fashion
 *
 * Lists published posts as cards. Doubles as a per-pillar archive when a
 * segment is passed. Emits Blog + Breadcrumb JSON-LD.
 */

import { SITE, sb, esc, renderShell, segmentMeta, SEGMENTS } from './_blog.js';

export default async function handler(req, res) {
  const segment = String(req.query.segment || '').toLowerCase().replace(/[^a-z]/g, '');
  const filterValid = segment && SEGMENTS[segment];

  let posts = [];
  try {
    let path = '/blog_posts?select=slug,segment,title,excerpt,meta_description,published_at,created_at'
      + '&status=eq.published&order=published_at.desc.nullslast,created_at.desc&limit=60';
    if (filterValid) path += `&segment=eq.${segment}`;
    posts = (await sb(path)) || [];
  } catch {
    posts = [];
  }

  const heading = filterValid ? segmentMeta(segment).label : 'The Journal';
  const sub = filterValid
    ? segmentMeta(segment).blurb
    : 'Honest, researched notes on living well in the UAE. Fashion, beauty, fragrance, wellness, travel and the city itself.';
  const url = filterValid ? `${SITE.base}/blog?segment=${segment}` : `${SITE.base}/blog`;

  const cards = posts.map((p) => {
    const seg = segmentMeta(p.segment);
    const dek = p.excerpt || p.meta_description || '';
    return `      <a class="bcard" href="/blog/${esc(p.slug)}">
        <span class="seg">${esc(seg.label)}</span>
        <h3>${esc(p.title)}</h3>
        <p>${esc(dek.length > 130 ? dek.slice(0, 130).trim() + '…' : dek)}</p>
      </a>`;
  }).join('\n');

  const body = `
    <div class="bhubhead">
      <p class="bkicker" style="text-align:center;">${filterValid ? esc(heading) : 'Dubai, UAE'}</p>
      <h1>${esc(heading)}</h1>
      <p>${esc(sub)}</p>
    </div>
    ${posts.length
      ? `<div class="bgrid">\n${cards}\n    </div>`
      : `<div class="bempty">New stories are on the way. Check back soon.</div>`}`;

  const blogLd = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: `${SITE.name} — Journal`,
    url,
    inLanguage: 'en-AE',
    author: { '@type': 'Person', name: SITE.name, url: SITE.base, sameAs: [SITE.ig] },
    blogPost: posts.slice(0, 20).map((p) => ({
      '@type': 'BlogPosting',
      headline: p.title,
      url: `${SITE.base}/blog/${p.slug}`,
      datePublished: p.published_at || p.created_at,
    })),
  };
  const head = `  <meta property="og:type" content="website" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:title" content="${esc(heading)} | Aastha Chopra" />
  <meta property="og:image" content="${esc(SITE.ogImage)}" />
  <meta property="og:locale" content="en_AE" />
  <meta name="twitter:card" content="summary_large_image" />
  <script type="application/ld+json">${JSON.stringify(blogLd)}</script>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=600, stale-while-revalidate=86400');
  return res.status(200).send(renderShell({
    title: `${heading} | Aastha Chopra`,
    description: sub,
    canonical: url,
    head,
    body,
    activeNav: 'blog',
  }));
}

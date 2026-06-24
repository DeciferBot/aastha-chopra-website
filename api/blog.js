/**
 * Single blog post — GET /blog/:slug  (rewritten to /api/blog?slug=:slug)
 *
 * Reads one PUBLISHED post and renders an SEO-complete page: canonical,
 * OG/Twitter, a JSON-LD @graph (Person + Article + BreadcrumbList + FAQPage),
 * a branded hero, the direct answer up top, an author box for E-E-A-T,
 * related posts in the same pillar (cluster linking), and the newsletter CTA.
 */

import {
  SITE, sb, esc, renderShell, ctaBlock, segmentMeta,
  renderHeroSVG, renderAuthorBox, renderPostCard, personSchema, renderInstagramBlock, postImage, attachInstagramImages,
} from './_blog.js';

export default async function handler(req, res) {
  const slug = String(req.query.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '');

  if (!slug) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send(notFound());
  }

  // A valid preview token lets drafts be viewed (e.g. on Aastha's phone)
  // before they are published. Otherwise only published posts are served.
  const previewOk = process.env.CRON_SECRET && req.query.preview === process.env.CRON_SECRET;

  let post;
  try {
    const statusFilter = previewOk ? '' : '&status=eq.published';
    const rows = await sb(
      `/blog_posts?slug=eq.${encodeURIComponent(slug)}${statusFilter}&limit=1`
    );
    post = rows && rows[0];
  } catch (err) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(500).send(notFound('We hit a snag loading this story.'));
  }

  if (!post) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.status(404).send(notFound());
  }

  // Best-effort view count; never block the render on it.
  sb(`/blog_posts?id=eq.${post.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ views: (post.views || 0) + 1 }),
  }).catch(() => {});

  // Related posts in the same pillar (cluster linking) for topical authority.
  let related = [];
  try {
    related = await sb(
      `/blog_posts?select=slug,segment,title,excerpt,meta_description,instagram_refs,hero_image_url`
      + `&status=eq.published&segment=eq.${encodeURIComponent(post.segment)}`
      + `&slug=neq.${encodeURIComponent(post.slug)}`
      + `&order=published_at.desc.nullslast,created_at.desc&limit=3`
    ) || [];
  } catch { related = []; }

  // Resolve hero + related-card images from the linked Instagram content (durable
  // Supabase Storage), batched in one query. Falls back to the pillar photo.
  try { await attachInstagramImages([post, ...related]); } catch {}

  const url = `${SITE.base}${SITE.blogPath}/${post.slug}`;
  const seg = segmentMeta(post.segment);
  // Share preview image = the post's own image (linked IG content), made absolute
  // for OG/Twitter; falls back to og_image then the site image.
  const ogRaw = post.og_image || postImage(post);
  const image = ogRaw.startsWith('http') ? ogRaw : `${SITE.base}${ogRaw}`;
  const published = post.published_at || post.created_at;
  const faq = Array.isArray(post.faq) ? post.faq : [];
  const sources = Array.isArray(post.research_sources) ? post.research_sources : [];

  const noindex = post.status !== 'published'
    ? '  <meta name="robots" content="noindex, nofollow" />\n'
    : '';
  const head = noindex + renderHead({ post, url, image, seg, published, faq });
  const body = renderArticle({ post, url, seg, published, faq, sources, related });

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(renderShell({
    title: `${post.title} | Aastha Chopra`,
    description: post.meta_description || post.excerpt || '',
    canonical: url,
    head,
    body,
    activeNav: 'blog',
  }));
}

function renderHead({ post, url, image, seg, published, faq }) {
  const desc = post.meta_description || post.excerpt || '';

  const graph = [
    personSchema(),
    {
      '@type': 'Article',
      headline: post.title,
      description: desc,
      image: [image],
      datePublished: published,
      dateModified: post.updated_at || published,
      inLanguage: 'en-AE',
      author: { '@id': `${SITE.base}/#aastha` },
      publisher: { '@id': `${SITE.base}/#aastha` },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      articleSection: seg.label,
      keywords: (post.seo_keywords || []).join(', '),
    },
    {
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Journal', item: `${SITE.base}/blog` },
        { '@type': 'ListItem', position: 2, name: seg.label, item: `${SITE.base}/blog?segment=${post.segment}` },
        { '@type': 'ListItem', position: 3, name: post.title, item: url },
      ],
    },
  ];
  if (faq.length) {
    graph.push({
      '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    });
  }
  const jsonLd = { '@context': 'https://schema.org', '@graph': graph };

  return `  <meta name="keywords" content="${esc((post.seo_keywords || []).join(', '))}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:title" content="${esc(post.title)}" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:image" content="${esc(image)}" />
  <meta property="og:site_name" content="Aastha Chopra" />
  <meta property="og:locale" content="en_AE" />
  <meta property="article:published_time" content="${esc(published)}" />
  <meta property="article:section" content="${esc(seg.label)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(post.title)}" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <meta name="twitter:image" content="${esc(image)}" />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
}

function renderArticle({ post, url, seg, published, faq, sources, related }) {
  const dateStr = new Date(published).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  const readMins = Math.max(2, Math.round((post.word_count || 0) / 220));

  const heroHtml = `<img class="bhero" src="${esc(postImage(post))}" alt="${esc(post.title)}" loading="eager" />`;

  const faqHtml = faq.length ? `
    <section class="bfaq">
      <h2>Questions people also ask</h2>
      ${faq.map((f) => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join('\n      ')}
    </section>` : '';

  const relatedHtml = (related && related.length) ? `
    <section class="brelated">
      <h2>More in ${esc(seg.label)}</h2>
      <div class="bgrid">
      ${related.map(renderPostCard).join('\n      ')}
      </div>
    </section>` : '';

  const sourcesHtml = sources.length ? `
    <section class="bsources">
      <h2>Sources</h2>
      <ul>
        ${sources.map((s) => `<li><a href="${esc(s.url)}" target="_blank" rel="noopener nofollow">${esc(s.title || s.url)}</a></li>`).join('\n        ')}
      </ul>
    </section>` : '';

  return `
    <article>
      <p class="bcrumb"><a href="/blog">Journal</a> &rsaquo; <a href="/blog?segment=${esc(post.segment)}">${esc(seg.label)}</a></p>
      <p class="bkicker">${esc(seg.label)}</p>
      <h1>${esc(post.title)}</h1>
      ${post.excerpt ? `<p class="bdek">${esc(post.excerpt)}</p>` : ''}
      <p class="bmeta">By ${esc(SITE.name)} &nbsp;·&nbsp; ${dateStr} &nbsp;·&nbsp; ${readMins} min read</p>
      ${heroHtml}
      ${post.body_html || ''}
      ${renderInstagramBlock(post.instagram_refs)}
      <p style="margin-top:36px;color:var(--text-mid);">More from Aastha's ${esc(seg.label.toLowerCase())} world: <a href="${esc(seg.page)}">explore here</a>.</p>
      ${renderAuthorBox()}
    </article>
    ${faqHtml}
    ${relatedHtml}
    ${ctaBlock()}
    ${sourcesHtml}`;
}

function notFound(msg) {
  return renderShell({
    title: 'Not found | Aastha Chopra',
    description: '',
    canonical: `${SITE.base}/blog`,
    activeNav: 'blog',
    body: `
      <div class="bempty">
        <p style="font-size:2rem;color:var(--gold);margin-bottom:16px;">404</p>
        <p>${esc(msg || 'This story has moved or never existed.')}</p>
        <p style="margin-top:24px;font-style:normal;font-family:var(--sans);font-size:.9rem;">
          <a href="/blog">Back to the Journal &rsaquo;</a>
        </p>
      </div>`,
  });
}

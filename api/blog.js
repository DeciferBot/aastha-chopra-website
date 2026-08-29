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
  renderHeroSVG, renderAuthorBox, renderPostCard, personSchema, organizationSchema, renderInstagramBlock, renderPicture, postImage, attachInstagramImages, dedupePostImages, sbImg, postDateParts, updatedDateParts,
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
    // Fetch by slug alone so merged posts are still found — they need to answer
    // a redirect, not a 404. The status check happens below.
    const rows = await sb(
      `/blog_posts?slug=eq.${encodeURIComponent(slug)}&limit=1`
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

  // Two posts covering the same question split their own ranking, so the weaker
  // one gets merged into the stronger one and points here. 301 keeps whatever
  // links and history the old URL earned.
  //
  // THE TARGET HAS TO BE ALIVE, and for a while it did not have to be.
  //
  // This redirected on the strength of the column alone, before the status
  // check below. That is fine until the target stops being published — and
  // api/cron/blog-audit.js exists precisely to unpublish a post when it finds a
  // wrong fact in it. When that happened to best-spas-in-dubai, the two posts
  // merged into it kept sending every visitor and every crawler to a page that
  // answered 404. Checked live on 2026-08-29: two 301s, both landing on a dead
  // page, one of them still ranking at position 7.
  //
  // So the redirect is followed only if there is something live at the end of
  // it. If there is not, the journal index is the honest destination: it is a
  // real page with the same pillar's writing on it, which is a far better
  // answer than a 404 for somebody who arrived from a search result.
  if (post.redirect_to && post.redirect_to !== post.slug) {
    let targetLive = false;
    try {
      const rows = await sb(
        `/blog_posts?slug=eq.${encodeURIComponent(post.redirect_to)}&status=eq.published&select=slug&limit=1`
      );
      targetLive = Boolean(rows && rows[0]);
    } catch {
      // A lookup that could not run is not evidence the target is dead. Send
      // them on: the old behaviour, which is right whenever the target is fine.
      targetLive = true;
    }
    // 301 when the target is alive, because that consolidation is permanent
    // and we want the old URL's history to move. 302 for the fallback, because
    // a target being unpublished is TEMPORARY: the fact audit pulls a post,
    // somebody fixes the fact, and it comes back. That happened on 2026-08-29,
    // hours after this file first started falling back. A 301 would have told
    // every browser and every crawler that the journal index was the permanent
    // home of those URLs, and 301s are cached hard and for a long time.
    //
    // Short cache on the fallback for the same reason: it should stop being
    // served within minutes of the target returning, not within a day.
    res.setHeader('Cache-Control', targetLive ? 's-maxage=86400' : 's-maxage=60');
    return targetLive
      ? res.redirect(301, `${SITE.blogPath}/${post.redirect_to}`)
      : res.redirect(302, SITE.blogPath);
  }

  if (post.status !== 'published' && !previewOk) {
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
      `/blog_posts?select=slug,segment,title,excerpt,meta_description,published_at,created_at,instagram_refs,hero_image_url`
      + `&status=eq.published&segment=eq.${encodeURIComponent(post.segment)}`
      + `&slug=neq.${encodeURIComponent(post.slug)}`
      + `&order=published_at.desc.nullslast,created_at.desc&limit=3`
    ) || [];
  } catch { related = []; }

  // Resolve hero + related-card images from the linked Instagram content (durable
  // Supabase Storage), batched in one query. Falls back to the pillar photo.
  try {
    await attachInstagramImages([post, ...related]);
    // Keep the post's own hero, then ensure each related card shows a different
    // photo (so the "More in …" row never repeats the hero or itself).
    dedupePostImages([post, ...related]);
  } catch {}

  const url = `${SITE.base}${SITE.blogPath}/${post.slug}`;
  const seg = segmentMeta(post.segment);
  // Share preview image = the post's own image (linked IG content), made absolute
  // for OG/Twitter; falls back to og_image then the site image.
  const ogRaw = post.og_image || postImage(post);
  const image = sbImg(ogRaw.startsWith('http') ? ogRaw : `${SITE.base}${ogRaw}`, 1200);
  const published = post.published_at || post.created_at;
  const faq = Array.isArray(post.faq) ? post.faq : [];
  const sources = Array.isArray(post.research_sources) ? post.research_sources : [];

  const noindex = post.status !== 'published'
    ? '  <meta name="robots" content="noindex, nofollow" />\n'
    : '';
  const head = noindex + renderHead({ post, url, image, seg, published, faq });
  const body = renderArticle({ post, url, seg, faq, sources, related });

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

  // Entities the piece is genuinely about. Google uses these to place the page
  // in a topic, and every one of them is a real thing with its own Wikipedia
  // entry, so they are safe to assert.
  const about = [
    { '@type': 'Place', name: 'Dubai', sameAs: 'https://en.wikipedia.org/wiki/Dubai' },
    { '@type': 'Thing', name: seg.label },
  ];

  const graph = [
    personSchema(),
    organizationSchema(),
    {
      '@type': 'WebSite',
      '@id': `${SITE.base}/#website`,
      url: SITE.base,
      name: SITE.name,
      publisher: { '@id': `${SITE.base}/#organization` },
      inLanguage: 'en-AE',
    },
    {
      '@type': 'Blog',
      '@id': `${SITE.base}/blog#blog`,
      name: `${SITE.name} — Journal`,
      url: `${SITE.base}/blog`,
      isPartOf: { '@id': `${SITE.base}/#website` },
    },
    {
      // The page itself, so mainEntityOfPage below points at a node that exists
      // rather than a bare id nothing defines.
      '@type': 'WebPage',
      '@id': url,
      url,
      name: post.title,
      description: desc,
      inLanguage: 'en-AE',
      isPartOf: { '@id': `${SITE.base}/#website` },
      primaryImageOfPage: { '@id': `${url}#primaryimage` },
      datePublished: published,
      dateModified: post.updated_at || published,
      breadcrumb: { '@id': `${url}#breadcrumb` },
    },
    {
      '@type': 'ImageObject',
      '@id': `${url}#primaryimage`,
      url: image,
      contentUrl: image,
      width: 1200,
      height: 1500,
      caption: post.title,
    },
    {
      '@type': 'BlogPosting',
      '@id': `${url}#article`,
      headline: post.title.slice(0, 110),
      name: post.title,
      description: desc,
      // An ImageObject with real dimensions is eligible for image-rich results
      // where a bare URL string is not.
      image: { '@id': `${url}#primaryimage` },
      datePublished: published,
      dateModified: post.updated_at || published,
      inLanguage: 'en-AE',
      author: { '@id': `${SITE.base}/#aastha` },
      publisher: { '@id': `${SITE.base}/#organization` },
      isPartOf: { '@id': `${SITE.base}/blog#blog` },
      mainEntityOfPage: { '@type': 'WebPage', '@id': url },
      articleSection: seg.label,
      about,
      wordCount: post.word_count || undefined,
      timeRequired: `PT${Math.max(2, Math.round((post.word_count || 0) / 220))}M`,
      keywords: (post.seo_keywords || []).join(', '),
      // The excerpt is written as the direct answer, which is exactly what a
      // voice assistant should read out.
      speakable: {
        '@type': 'SpeakableSpecification',
        cssSelector: ['.bdek', 'article h1'],
      },
      // Declaring the licence and sourcing policy is an E-E-A-T signal and it
      // happens to be true: every post lists the sources it used.
      isAccessibleForFree: true,
      creativeWorkStatus: 'Published',
    },
    {
      '@type': 'BreadcrumbList',
      '@id': `${url}#breadcrumb`,
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: `${SITE.base}/` },
        { '@type': 'ListItem', position: 2, name: 'Journal', item: `${SITE.base}/blog` },
        { '@type': 'ListItem', position: 3, name: seg.label, item: `${SITE.base}/blog?segment=${post.segment}` },
        { '@type': 'ListItem', position: 4, name: post.title, item: url },
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
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="1500" />
  <meta property="og:image:alt" content="${esc(post.title)}" />
  <meta property="article:modified_time" content="${esc(post.updated_at || published)}" />
  <meta property="article:author" content="${esc(SITE.name)}" />
  <meta name="author" content="${esc(SITE.name)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(post.title)}" />
  <meta name="twitter:description" content="${esc(desc)}" />
  <meta name="twitter:image" content="${esc(image)}" />
  <meta name="twitter:image:alt" content="${esc(post.title)}" />
  <meta name="twitter:label1" content="Written by" />
  <meta name="twitter:data1" content="${esc(SITE.name)}" />
  <meta name="twitter:label2" content="Reading time" />
  <meta name="twitter:data2" content="${Math.max(2, Math.round((post.word_count || 0) / 220))} min" />
  <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
}

function renderArticle({ post, url, seg, faq, sources, related }) {
  const date = postDateParts(post);
  const updated = updatedDateParts(post);
  const readMins = Math.max(2, Math.round((post.word_count || 0) / 220));
  // Built from parts so a dateless post doesn't render a stray separator.
  const byline = [
    `By ${esc(SITE.name)}`,
    ...(date ? [`<time datetime="${esc(date.iso)}">${esc(date.label)}</time>`] : []),
    ...(updated ? [`Updated <time datetime="${esc(updated.iso)}">${esc(updated.label)}</time>`] : []),
    `${readMins} min read`,
  ].join(' &nbsp;·&nbsp; ');

  const heroSrc = sbImg(postImage(post), 1200);
  const himg = esc(heroSrc);
  const heroHtml = `<div class="bhero" style="--img:url('${himg}')">${renderPicture({ src: heroSrc, alt: post.title, eager: true })}</div>`;

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
      <p class="bmeta">${byline}</p>
      ${heroHtml}
      ${post.body_html || ''}
      ${renderInstagramBlock(post.instagram_refs)}
      <p style="margin-top:36px;color:var(--text-mid);">All my <a href="/blog?segment=${esc(post.segment)}">${esc(seg.label)}</a> guides &nbsp;·&nbsp; Brands: <a href="${esc(seg.page)}">work with me on ${esc(seg.label.toLowerCase())}</a>.</p>
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

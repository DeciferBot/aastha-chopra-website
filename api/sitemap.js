/**
 * Dynamic sitemap — GET /sitemap.xml  (rewritten to /api/sitemap)
 *
 * Replaces the old static sitemap.xml so newly published blog posts appear
 * automatically. Core static pages + their image entries are preserved here;
 * published blog_posts are appended, newest first.
 */

import { SITE, sb, esc } from './_blog.js';

const CORE = [
  { loc: '/',               changefreq: 'weekly',  priority: '1.0', images: [
    { loc: '/images/aastha-chopra-dubai-luxury-fashion-beauty.jpg', title: 'Aastha Chopra — Dubai luxury fashion and beauty influencer' },
    { loc: '/images/og-image.jpg', title: 'Aastha Chopra — Official Portfolio' },
  ] },
  { loc: '/fashion.html',   changefreq: 'weekly',  priority: '0.9', images: [
    { loc: '/images/og-image.jpg', title: 'Aastha Chopra — Dubai Fashion & Beauty Creator' },
  ] },
  { loc: '/luxury.html',    changefreq: 'weekly',  priority: '0.9', images: [
    { loc: '/images/og-image.jpg', title: 'Aastha Chopra — Dubai Luxury & Travel Insider' },
  ] },
  { loc: '/wellness.html',  changefreq: 'weekly',  priority: '0.9', images: [
    { loc: '/images/og-image.jpg', title: 'Aastha Chopra — Dubai Wellness & Fitness Creator' },
  ] },
  { loc: '/blog',           changefreq: 'daily',   priority: '0.8' },
  { loc: '/media-pack.html', changefreq: 'weekly', priority: '0.8' },
  { loc: '/privacy.html',   changefreq: 'yearly',  priority: '0.3' },
];

export default async function handler(req, res) {
  const today = new Date().toISOString().slice(0, 10);

  let posts = [];
  try {
    posts = (await sb(
      '/blog_posts?select=slug,published_at,updated_at,hero_image_url,title'
      + '&status=eq.published&order=published_at.desc.nullslast&limit=2000'
    )) || [];
  } catch {
    posts = [];
  }

  const coreXml = CORE.map((p) => urlEntry({
    loc: SITE.base + p.loc,
    lastmod: today,
    changefreq: p.changefreq,
    priority: p.priority,
    images: p.images,
  })).join('\n');

  const postsXml = posts.map((p) => urlEntry({
    loc: `${SITE.base}/blog/${p.slug}`,
    lastmod: (p.updated_at || p.published_at || today).slice(0, 10),
    changefreq: 'monthly',
    priority: '0.7',
    images: p.hero_image_url ? [{ loc: p.hero_image_url, title: p.title }] : [],
  })).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${coreXml}${postsXml ? '\n' + postsXml : ''}
</urlset>`;

  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
  return res.status(200).send(xml);
}

function urlEntry({ loc, lastmod, changefreq, priority, images = [] }) {
  const imgXml = images.map((img) => `    <image:image>
      <image:loc>${esc(img.loc.startsWith('http') ? img.loc : SITE.base + img.loc)}</image:loc>
      <image:title>${esc(img.title)}</image:title>
    </image:image>`).join('\n');
  return `  <url>
    <loc>${esc(loc)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${changefreq}</changefreq>
    <priority>${priority}</priority>${imgXml ? '\n' + imgXml : ''}
  </url>`;
}

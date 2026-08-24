/**
 * Publish (or unpublish) a Journal draft — GET /api/blog-publish?slug=…&key=CRON_SECRET
 *
 * The generator now writes drafts only; nothing goes live until a person has
 * read it. This is the "yes" button: a link that works from a phone, gated by
 * the same secret the preview link uses. Add &action=unpublish to pull a post.
 */

import { sb, SITE } from './_blog.js';

const INDEXNOW_KEY = 'b4bd21537f724b699428afa92452c614';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const authed = secret && (req.query.key === secret || req.headers.authorization === `Bearer ${secret}`);
  if (!authed) return res.status(401).json({ ok: false, error: 'unauthorised' });

  const slug = String(req.query.slug || '').toLowerCase().replace(/[^a-z0-9-]/g, '');
  const action = req.query.action === 'unpublish' ? 'unpublish' : 'publish';
  if (!slug) return res.status(400).json({ ok: false, error: 'slug required' });

  const rows = await sb(`/blog_posts?slug=eq.${encodeURIComponent(slug)}&select=id,slug,status,published_at&limit=1`);
  const post = rows && rows[0];
  if (!post) return res.status(404).json({ ok: false, error: 'no such post' });
  if (post.status === 'merged') return res.status(409).json({ ok: false, error: 'post is merged into another; nothing to publish' });

  const now = new Date().toISOString();
  const patch = action === 'publish'
    ? { status: 'published', published_at: post.published_at || now, updated_at: now }
    : { status: 'draft', updated_at: now };

  await sb(`/blog_posts?id=eq.${post.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify(patch),
  });

  const url = `${SITE.base}${SITE.blogPath}/${post.slug}`;
  if (action === 'publish') {
    // Bing/Yandex pick the page up within minutes; Google follows the sitemap.
    fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ host: 'www.aasthachopra.com', key: INDEXNOW_KEY, keyLocation: `${SITE.base}/${INDEXNOW_KEY}.txt`, urlList: [url] }),
    }).catch(() => {});
  }

  // A person tapping a link wants to see the result, not JSON.
  if (req.headers.accept && req.headers.accept.includes('text/html')) {
    return res.redirect(302, action === 'publish' ? url : `${url}?preview=${encodeURIComponent(secret)}`);
  }
  return res.status(200).json({ ok: true, action, slug: post.slug, url });
}

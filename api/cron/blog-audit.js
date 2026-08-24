/**
 * Post-publish fact audit — Vercel Cron, weekly.
 * GET /api/cron/blog-audit          audit the two least recently checked posts
 * GET /api/cron/blog-audit?limit=5  audit more in one run
 *
 * The gates in api/_blog-qa.js run before a post goes live, which stops the
 * obvious failures. They cannot stop two things:
 *
 *   1. a wrong fact the checker did not catch on the day
 *   2. a fact that was right when written and is not any more, which is most
 *      prices, opening hours and "the newest branch is at X"
 *
 * So every published post gets re-checked on a rotation, oldest audit first.
 * A post found to contain something plainly wrong is pulled back to
 * `needs_work` (it 404s immediately and drops out of the sitemap) and the
 * failure is emailed. Everything else just gets its audit date stamped.
 *
 * Unpublishing is the safe direction: a missing page costs a little traffic, a
 * wrong one costs the trust the site is built on.
 *
 * Auth: Bearer CRON_SECRET, same as the other crons.
 */

import { sb, SITE } from '../_blog.js';
import { factGate } from '../_blog-qa.js';

export const config = { maxDuration: 300 };

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY = process.env.RESEND_API_KEY;
const ALERT_EMAIL = process.env.ALERT_EMAIL || 'chopraa@gmail.com';
const ALERT_FROM = 'Site Monitor <hello@aasthachopra.com>';

// Two per weekly run keeps every post checked a few times a year at 42 posts,
// and keeps the run inside one function invocation.
const DEFAULT_LIMIT = 2;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  const authed = req.headers.authorization === `Bearer ${secret}`
    || (secret && req.query.key === secret)
    || (process.env.MANUAL_SYNC_KEY && req.query.key === process.env.MANUAL_SYNC_KEY);
  if (!authed) return res.status(401).end();

  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || DEFAULT_LIMIT, 1), 6);
  const checked = [];
  const pulled = [];

  try {
    // Oldest audit first; never audited (null) sorts first on nullsfirst.
    const posts = await sb(
      '/blog_posts?select=id,slug,title,body_html,faq,audited_at&status=eq.published'
      + `&order=audited_at.asc.nullsfirst&limit=${limit}`
    ) || [];

    for (const post of posts) {
      let result;
      try {
        result = await factGate({ post, callClaude, parseJson });
      } catch (err) {
        // An audit that could not run is not evidence of a problem. Leave the
        // post alone and leave audited_at untouched so it is retried next week.
        checked.push({ slug: post.slug, state: 'audit failed', error: err.message });
        continue;
      }

      const wrong = (result.claims || []).filter((c) => String(c && c.verdict).toLowerCase() === 'wrong');

      if (wrong.length) {
        await sb(`/blog_posts?id=eq.${post.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ status: 'needs_work', audited_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
        });
        pulled.push({ slug: post.slug, title: post.title, wrong });
        checked.push({ slug: post.slug, state: 'unpublished', wrong: wrong.length });
      } else {
        await sb(`/blog_posts?id=eq.${post.id}`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ audited_at: new Date().toISOString() }),
        });
        checked.push({ slug: post.slug, state: 'ok', unverified: result.unverifiedCount || 0 });
      }
    }

    if (pulled.length) await alert(pulled).catch(() => {});

    return res.status(200).json({ ok: true, checked, unpublished: pulled.length });
  } catch (err) {
    return res.status(500).json({ ok: false, error: err.message, checked });
  }
}

/** Only fires when a live post was actually pulled, so it stays worth reading. */
async function alert(pulled) {
  const lines = pulled.map((p) => {
    const claims = p.wrong.slice(0, 4).map((c) => `     - "${String(c.claim).slice(0, 160)}"\n       ${String(c.note || '').slice(0, 160)}`).join('\n');
    return `• ${p.title}\n   ${SITE.base}/blog/${p.slug}\n${claims}`;
  }).join('\n\n');

  const subject = pulled.length === 1
    ? `Journal: pulled "${pulled[0].title}" after a fact check`.slice(0, 140)
    : `Journal: pulled ${pulled.length} posts after a fact check`;

  const text = [
    `${pulled.length} published post${pulled.length === 1 ? ' was' : 's were'} taken down by the weekly fact audit.`,
    'They now return 404 and have dropped out of the sitemap. Nothing else changed.',
    '',
    lines,
    '',
    'Fix the claim and republish, or leave it down.',
    '',
    '— aasthachopra.com',
  ].join('\n');

  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: ALERT_FROM, to: ALERT_EMAIL, subject, text }),
  });
}

// ── Shared shapes the gate module expects ──────────────────────────────────

async function callClaude({ system, user, useTools, maxTokens = 4000, maxSearches = 6 }) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system,
    messages: [{ role: 'user', content: user }],
  };
  if (useTools) body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: maxSearches }];
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Anthropic: ${await res.text()}`);
  return res.json();
}

function parseJson(text) {
  if (!text) return null;
  const t = String(text).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

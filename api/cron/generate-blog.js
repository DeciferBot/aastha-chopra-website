/**
 * Blog generator — Vercel Cron / on-demand.
 * GET /api/cron/generate-blog        -> dry run, writes ONE draft, publishes nothing
 * GET /api/cron/generate-blog?publish=1   -> writes and publishes (used by the live cron)
 * GET /api/cron/generate-blog?segment=fragrance   -> force a pillar
 *
 * Pipeline:
 *   1. Pick a rotating pillar + a fresh, unused trending row from uae_signals
 *   2. Expand into the real questions people search via Google autocomplete (UAE)
 *   3. Deep research + write in ONE Claude call using the server-side web_search
 *      tool (multi-source, the cron-viable equivalent of the deep-research skill)
 *   4. Sanitise to the locked voice (no em dashes, no <h1>, no scripts) and store
 *
 * Skips cleanly when there is no real topic or the model cannot ground the piece.
 * Auth: Bearer CRON_SECRET, same as the other crons.
 */

import { sb, SEGMENTS, SITE, segmentMeta } from '../_blog.js';

export const config = { maxDuration: 300 };

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const SEG_KEYS = Object.keys(SEGMENTS);

export default async function handler(req, res) {
  // Cron uses the Bearer header; ?key= lets it be triggered by tapping a link
  // from a phone during the dry-run review phase. Both gate on CRON_SECRET.
  const secret = process.env.CRON_SECRET;
  const authed = req.headers.authorization === `Bearer ${secret}` || (secret && req.query.key === secret);
  if (!authed) {
    return res.status(401).end();
  }

  const startMs = Date.now();
  const dryRun = req.query.publish !== '1';
  const errors = [];
  let segment = String(req.query.segment || '').toLowerCase();
  let topic = null;
  let queriesFound = 0;
  let sourcesUsed = 0;
  let created = null;

  try {
    // ── 1. Pillar (rotates by day so every segment gets covered) ──────────
    if (!SEGMENTS[segment]) {
      const doy = Math.floor((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 0)) / 86400000);
      segment = SEG_KEYS[doy % SEG_KEYS.length];
    }
    const seg = segmentMeta(segment);

    // ── 2. Fresh, unused trending signal ─────────────────────────────────
    const since = new Date(Date.now() - 21 * 86400000).toISOString();
    const signals = await sb(
      `/uae_signals?select=id,title,description,category,tags,source_name`
      + `&scraped_at=gte.${since}&order=relevance_score.desc&limit=30`
    ) || [];

    const usedRows = await sb('/blog_posts?select=source_signal_id') || [];
    const used = new Set(usedRows.map((r) => r.source_signal_id).filter(Boolean));

    // Prefer a signal whose category/tags match the pillar; fall back to top unused.
    const fresh = signals.filter((s) => !used.has(s.id));
    const matchTerm = seg.label.toLowerCase();
    const signal = fresh.find((s) =>
      String(s.category || '').toLowerCase().includes(matchTerm)
      || (s.tags || []).some((t) => String(t).toLowerCase().includes(matchTerm))
    ) || fresh[0];

    if (!signal) {
      await logRun({ startMs, segment, status: 'skipped', dryRun, errors: ['No fresh signal to write about'] });
      return res.status(200).json({ ok: true, note: 'No fresh signal', segment });
    }
    topic = signal.title;

    // ── 3. Real questions from Google autocomplete (UAE locale) ───────────
    const seeds = [
      `best ${matchTerm} dubai`,
      `${matchTerm} dubai`,
      ...['how', 'what', 'where', 'which', 'is'].map((q) => `${q} ${matchTerm} dubai`),
    ];
    const suggestions = new Set();
    for (const seed of seeds) {
      for (const s of await autocomplete(seed)) {
        if (s.length > 8) suggestions.add(s);
      }
    }
    const questions = [...suggestions]
      .filter((s) => /\b(how|what|where|which|why|is|are|can|do|does|best|cost|price)\b/i.test(s))
      .slice(0, 25);
    queriesFound = questions.length;

    // ── 4. Deep research + write ─────────────────────────────────────────
    const { post, sources } = await researchAndWrite({ seg, segment, signal, questions });
    sourcesUsed = sources.length;

    // ── 5. Sanitise + dedupe slug ────────────────────────────────────────
    let slug = slugify(post.slug || post.title);
    slug = await uniqueSlug(slug);

    const bodyHtml = sanitiseBody(post.body_html || '');
    const wordCount = countWords(bodyHtml);

    if (wordCount < 350) {
      errors.push(`Thin draft (${wordCount} words), storing anyway for review`);
    }

    const row = {
      slug,
      segment,
      title: noDash(post.title || topic),
      meta_description: noDash(post.meta_description || '').slice(0, 200),
      excerpt: noDash(post.excerpt || ''),
      body_html: bodyHtml,
      seo_keywords: arr(post.seo_keywords).slice(0, 12),
      target_queries: (post.target_queries && arr(post.target_queries).length ? arr(post.target_queries) : questions).slice(0, 20),
      faq: arr(post.faq).filter((f) => f && f.q && f.a).map((f) => ({ q: noDash(f.q), a: noDash(f.a) })).slice(0, 6),
      research_sources: sources.slice(0, 8),
      word_count: wordCount,
      source_signal_id: signal.id,
      status: dryRun ? 'draft' : 'published',
      published_at: dryRun ? null : new Date().toISOString(),
    };

    const [saved] = await sb('/blog_posts', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify(row),
    });
    created = { slug: saved.slug, title: saved.title, status: saved.status, words: saved.word_count };

    await logRun({
      startMs, segment, topic, status: errors.length ? 'partial' : 'success',
      dryRun, postsCreated: 1, queriesFound, sourcesUsed, errors,
    });

    // Caller already proved the secret, so hand back a directly tappable link:
    // drafts need the preview token, published posts are public.
    const liveUrl = `${SITE.base}/blog/${saved.slug}`;
    const previewUrl = dryRun ? `${liveUrl}?preview=${encodeURIComponent(secret)}` : liveUrl;
    return res.status(200).json({
      ok: true, dryRun, segment, created,
      preview: previewUrl,
      queriesFound, sourcesUsed, errors,
    });

  } catch (err) {
    errors.push(err.message);
    await logRun({ startMs, segment, topic, status: 'failed', dryRun, queriesFound, sourcesUsed, errors }).catch(() => {});
    return res.status(500).json({ ok: false, error: err.message, segment });
  }
}

// ── Google autocomplete (UAE) ──────────────────────────────────────────────
async function autocomplete(query) {
  try {
    const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=ae&q=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    return Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [];
  } catch {
    return [];
  }
}

// ── Claude: research with web_search, then write ───────────────────────────
async function researchAndWrite({ seg, segment, signal, questions }) {
  const system = `You are Aastha Chopra, a Dubai-based lifestyle creator (fashion, beauty, fragrance, wellness). You are writing a post for your OWN website, aasthachopra.com, for women in the UAE aged 25 to 44, many of them South Asian expats in Dubai.

Your job is to answer a real question people search on Google, completely and usefully, so the post earns its ranking.

NON-NEGOTIABLE RULES:
- Real value only. No filler intro, no "in today's world", no padding. Every paragraph teaches something.
- Be specific to the UAE: real neighbourhoods, malls, venues, AED prices, the climate and seasons, local context. Never invent facts, names or prices. If you are not sure, leave it out.
- Use the web_search tool to research current, accurate details BEFORE writing. Search a few times. Prefer recent, reputable sources.
- Voice: first person, honest, warm, confident, a little personal. Write like a real person talking, not a brand.
- NEVER use em dashes. Not once. Use commas, full stops, or rewrite the sentence.
- Structure: a short direct answer first, then depth under question-style H2 headings (the related things people also ask). Keep paragraphs short.
- The body is clean semantic HTML only: <p>, <h2>, <h3>, <ul>/<li>, <ol>/<li>, <blockquote>, and <table> when it genuinely helps. No <h1>, no inline styles, no <script>, no images, no markdown.
- This is content for the ${seg.label} pillar. Angle: ${require_angle(segment)}`;

  const user = `TRENDING UAE CONTEXT (your starting point, ground the post in this where it fits):
Title: ${signal.title}
${signal.description ? `Detail: ${signal.description}\n` : ''}Category: ${signal.category || 'n/a'}
Source: ${signal.source_name || 'n/a'}

REAL QUESTIONS PEOPLE SEARCH (from Google autocomplete, UAE). Pick the single most valuable, rankable question as your title, and use the related ones as H2s and FAQ:
${questions.length ? questions.map((q) => `- ${q}`).join('\n') : '- (none returned; choose a strong question yourself for this pillar in a UAE context)'}

Research the topic with web_search, then return ONLY a JSON object (no prose, no code fences) with exactly these keys:
{
  "title": "the question as people type it",
  "slug": "kebab-case-url-slug",
  "meta_description": "150 to 160 characters, compelling, includes the key phrase",
  "excerpt": "one or two sentence direct answer shown at the top",
  "body_html": "the full article as clean HTML, no h1",
  "faq": [{"q":"question","a":"answer"}],
  "seo_keywords": ["keyword", "..."],
  "target_queries": ["the real queries this post targets"],
  "sources": [{"title":"source title","url":"https://..."}]
}`;

  let data;
  try {
    data = await callClaude({ system, user, useTools: true });
  } catch (e) {
    // Fallback: still produce a draft for review, flagged by empty sources.
    data = await callClaude({ system: system + '\n(Note: web_search unavailable, write from reliable knowledge and do not invent specifics.)', user, useTools: false });
  }

  const { text, sources: citedSources } = extractTextAndSources(data);
  const post = parseJson(text);
  if (!post || !post.title || !post.body_html) {
    throw new Error('Model did not return usable post JSON');
  }

  // Merge model-declared sources with real citation URLs from the search results.
  const map = new Map();
  for (const s of [...arr(post.sources), ...citedSources]) {
    if (s && s.url) map.set(s.url, { url: s.url, title: s.title || s.url });
  }
  return { post, sources: [...map.values()] };
}

function require_angle(segment) {
  const ANGLES = {
    fashion: 'style pieces into real Dubai life so clothes read as worn and wanted',
    beauty: 'honest daily use, the texture and wear that make a beauty audience trust you',
    fragrance: 'scent as a feeling and a memory, the way Gulf fragrance lovers think about it',
    jewellery: 'the moments and occasions a piece is worn for, so it carries meaning',
    wellness: 'a believable daily routine that reads as part of real life',
    hospitality: 'a stay or a meal your reader wants to recreate',
    travel: 'a destination built into a story with a clear arc people can plan',
    automobile: 'the car inside an aspirational lifestyle, not a spec sheet',
    retail: 'a wide range made personal and shoppable across everyday city life',
  };
  return ANGLES[segment] || 'real, useful, Dubai-grounded storytelling';
}

async function callClaude({ system, user, useTools }) {
  const body = {
    model: 'claude-sonnet-4-6',
    max_tokens: 6000,
    system,
    messages: [{ role: 'user', content: user }],
  };
  if (useTools) {
    body.tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }];
  }
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

function extractTextAndSources(data) {
  let text = '';
  const src = new Map();
  for (const b of data.content || []) {
    if (b.type === 'text') {
      text += b.text;
      for (const c of b.citations || []) {
        if (c.url) src.set(c.url, { url: c.url, title: c.title || c.url });
      }
    } else if (b.type === 'web_search_tool_result') {
      for (const r of b.content || []) {
        if (r && r.url) src.set(r.url, { url: r.url, title: r.title || r.url });
      }
    }
  }
  return { text, sources: [...src.values()] };
}

function parseJson(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(t.slice(start, end + 1)); } catch { return null; }
}

// ── Sanitisers ──────────────────────────────────────────────────────────────
function noDash(s) {
  return String(s ?? '').replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',').trim();
}
function sanitiseBody(html) {
  return noDash(
    String(html)
      .replace(/<h1[\s\S]*?<\/h1>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/ style="[^"]*"/gi, '')
      .replace(/^```(?:html)?/i, '')
      .replace(/```$/, '')
  ).trim();
}
function countWords(html) {
  return String(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
}
function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
}
async function uniqueSlug(base) {
  let slug = base || 'post';
  for (let i = 0; i < 12; i++) {
    const rows = await sb(`/blog_posts?slug=eq.${encodeURIComponent(slug)}&select=slug&limit=1`);
    if (!rows || !rows.length) return slug;
    slug = `${base}-${i + 2}`;
  }
  return `${base}-${Date.now().toString().slice(-5)}`;
}
function arr(x) { return Array.isArray(x) ? x : []; }

async function logRun({ startMs, segment, topic, status, dryRun, postsCreated = 0, queriesFound = 0, sourcesUsed = 0, errors = [] }) {
  await sb('/blog_agent_runs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      segment, topic, status, dry_run: dryRun,
      posts_created: postsCreated, queries_found: queriesFound, sources_used: sourcesUsed,
      errors, duration_ms: Date.now() - startMs,
    }),
  });
}

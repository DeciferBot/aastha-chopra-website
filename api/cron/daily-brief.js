/**
 * Daily Brief Generator — Vercel Cron
 * Runs at 2:30 UTC (6:30am Dubai time) every day.
 * Pulls UAE signals from DB, grounds "Your Angle" in Aastha's
 * verified top-performing posts, writes cards to uae_daily_brief.
 * GET /api/cron/daily-brief
 */

const SUPABASE_URL  = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${path}: ${await res.text()}`);
  return res.json();
}

async function claude(prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const startMs = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  let signalsFound = 0;
  let cardsGenerated = 0;
  const errors = [];

  try {
    // ── 1. Pull today's UAE signals ───────────────────────────────────
    const signals = await sb(
      `/uae_signals?scraped_at=gte.${today}T00:00:00Z&order=relevance_score.desc&limit=9`
    );
    signalsFound = signals.length;

    if (!signals.length) {
      await logRun({ today, startMs, signalsFound: 0, cardsGenerated: 0, status: 'partial', errors: ['No signals found for today'] });
      return res.status(200).json({ ok: true, note: 'No signals' });
    }

    // ── 2. Pull her top-performing posts for grounding ────────────────
    const topPosts = await sb(
      `/instagram_posts?select=caption,media_type,like_count,comments_count,reach&order=like_count.desc&limit=12&like_count=gte.500`
    );

    const topPostsSummary = topPosts.map(p => {
      const eng = p.like_count + (p.comments_count || 0) * 3;
      const type = p.media_type === 'CAROUSEL_ALBUM' ? 'carousel' :
                   p.media_type === 'VIDEO' ? 'video' : 'image';
      const preview = (p.caption || '').slice(0, 120).replace(/\n/g, ' ');
      return `- ${type} (${p.like_count.toLocaleString()} likes, eng ${eng.toLocaleString()}): "${preview}"`;
    }).join('\n');

    // ── 3. Group signals into up to 3 cards ──────────────────────────
    // Pick the 3 most distinct signals by category
    const seen = new Set();
    const picked = [];
    for (const s of signals) {
      const key = s.category || 'other';
      if (!seen.has(key) && picked.length < 3) { seen.add(key); picked.push(s); }
    }
    // Fill if fewer than 3 categories
    for (const s of signals) {
      if (picked.length >= 3) break;
      if (!picked.includes(s)) picked.push(s);
    }

    // ── 4. Generate each card with Claude ────────────────────────────
    const cards = [];
    for (let i = 0; i < picked.length; i++) {
      const signal = picked[i];
      const cardType = signal.category || 'trend';

      const prompt = `You are a strategic content advisor for Aastha Chopra, a UAE-based luxury lifestyle and fashion creator with 50K+ followers. Her audience is 60% UAE-based, 25-44 female.

VERIFIED HIGH-PERFORMING CONTENT (from her actual Instagram analytics — use this to ground your advice):
${topPostsSummary}

TODAY'S UAE SIGNAL:
Title: ${signal.title}
Source: ${signal.source_name}
Category: ${cardType}
Tags: ${(signal.tags || []).join(', ')}
${signal.description ? `Description: ${signal.description}` : ''}

Generate a content brief card. Return ONLY valid JSON, no markdown, no explanation:
{
  "headline": "5-8 word headline for Aastha's content opportunity (not the news headline)",
  "context": "2-3 sentences: why this is relevant to her UAE audience right now, grounded in what content types actually work for her",
  "angle": "Specific, actionable content idea for Aastha — reference the format (carousel/video/reel) and caption hook that matches her proven winners. 3-4 sentences.",
  "hashtags": ["#Tag1", "#Tag2", "#Tag3", "#Tag4", "#Tag5"],
  "creator_accounts": ["@handle1", "@handle2"],
  "tag_accounts": ["@brand1", "@brand2", "@venue1"]
}

Rules:
- creator_accounts: ONLY real human influencer/creator handles relevant to this signal (NOT brands, venues, malls, magazines, or luxury houses)
- tag_accounts: brand/venue handles to tag for reach
- The angle MUST reference one of her proven content formats (carousel of outfits/moments, candid video, event walkthrough) based on her top posts above
- Keep it grounded in Dubai/UAE context, not generic fashion advice`;

      try {
        const raw = await claude(prompt);
        const json = JSON.parse(raw.trim());
        cards.push({
          brief_date: today,
          card_order: i + 1,
          card_type: cardType,
          headline: json.headline,
          context: json.context,
          angle: json.angle,
          hashtags: json.hashtags || [],
          tag_accounts: json.tag_accounts || [],
          creator_accounts: json.creator_accounts || [],
          signal_id: signal.id,
        });
      } catch (e) {
        errors.push(`Card ${i + 1} (${signal.title?.slice(0, 40)}): ${e.message}`);
      }
    }

    cardsGenerated = cards.length;

    if (cards.length) {
      // Delete old cards for today first (idempotent re-runs)
      await sb(`/uae_daily_brief?brief_date=eq.${today}`, { method: 'DELETE' });
      await sb('/uae_daily_brief', {
        method: 'POST',
        body: JSON.stringify(cards),
      });
    }

    await logRun({
      today, startMs, signalsFound, cardsGenerated,
      status: errors.length && !cardsGenerated ? 'failed' : errors.length ? 'partial' : 'success',
      errors,
    });

    return res.status(200).json({ ok: true, signalsFound, cardsGenerated, errors });

  } catch (err) {
    errors.push(err.message);
    await logRun({ today, startMs, signalsFound, cardsGenerated, status: 'failed', errors }).catch(() => {});
    return res.status(500).json({ ok: false, error: err.message });
  }
}

async function logRun({ today, startMs, signalsFound, cardsGenerated, status, errors }) {
  await sb('/uae_agent_runs', {
    method: 'POST',
    body: JSON.stringify({
      ran_at: new Date().toISOString(),
      signals_found: signalsFound,
      cards_generated: cardsGenerated,
      errors,
      duration_ms: Date.now() - startMs,
      status,
    }),
  });
}

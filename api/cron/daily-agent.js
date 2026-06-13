/**
 * Daily Outreach Agent — Vercel Cron
 * Runs at 2:00 UTC (6:00 AM UAE time) every day.
 * Scores brands, generates pitches for top 3 grounded in LIVE Instagram numbers,
 * stores them in brand_pitches, and emails one forward-ready pitch per brand.
 * GET /api/cron/daily-agent
 */

import { getLiveProfile, STATIC_PROFILE } from '../_profile.js';

const SUPABASE_URL  = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const FB_TOKEN      = process.env.FB_ACCESS_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const AASTHA_EMAIL  = 'aasthac8@gmail.com';

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
  if (!res.ok) throw new Error(`Supabase: ${await res.text()}`);
  return res.json();
}

async function checkAdLibrary(brandName) {
  if (!FB_TOKEN) return null;
  try {
    const params = new URLSearchParams({
      search_terms: brandName,
      ad_type: 'ALL',
      ad_reached_countries: '["AE"]',
      ad_active_status: 'ACTIVE',
      limit: '10',
      fields: 'id,page_name,ad_delivery_start_time',
      access_token: FB_TOKEN,
    });
    const res = await fetch(`https://graph.facebook.com/v21.0/ads_archive?${params}`);
    const data = await res.json();
    if (data.error || !data.data) return null;
    const ads = data.data;
    const now = Date.now();
    const recentAds = ads.filter(ad => {
      if (!ad.ad_delivery_start_time) return false;
      return (now - new Date(ad.ad_delivery_start_time).getTime()) < 14 * 24 * 60 * 60 * 1000;
    });
    return { active: ads.length > 0, count: ads.length, recentCount: recentAds.length };
  } catch { return null; }
}

function scoreBrand(brand, adData) {
  let score = 0;
  if (adData?.active)            score += 3;
  if (adData?.recentCount > 0)   score += 2;
  if (brand.niche_fit === 'high')   score += 3;
  if (brand.niche_fit === 'medium') score += 1;
  if (brand.contact_email)       score += 1;
  return Math.min(score, 10);
}

/**
 * Build the ONLY stats block the pitch is allowed to cite. Every line here is a
 * real number pulled live from Instagram, so nothing the model writes can drift
 * from what a brand sees if they check her insights.
 */
function buildFactSheet(profile) {
  const facts = [];
  if (profile.followers) facts.push(`${profile.followers.toLocaleString()} Instagram followers`);
  if (profile.uaeReach) {
    facts.push(`${profile.uaeReach.toLocaleString()} accounts reached in the UAE in the last 30 days`);
  } else if (profile.uaeFollowers) {
    facts.push(`a UAE following of ${profile.uaeFollowers.toLocaleString()}${profile.uaePct ? ` (${profile.uaePct}% of her located audience)` : ''}, concentrated in the UAE`);
  }
  if (profile.topCities?.length) {
    facts.push(`top cities are ${profile.topCities.map((c) => c.city).join(', ')}`);
  }
  if (profile.coreAge) facts.push(`core audience is ${profile.coreAge} year olds with a strong South Asian diaspora in the UAE`);
  return facts.map((f) => `- ${f}`).join('\n');
}

/**
 * @returns {Promise<{subject:string, body:string}>}
 */
async function generatePitch(brandName, profile, brandNotes = '') {
  const factSheet = buildFactSheet(profile);

  const systemPrompt = `You write outreach emails from Aastha Chopra, a Dubai-based lifestyle creator, to brand managers.

VOICE: Confident, warm, direct. Reads like a real person wrote it — not a template, not a tool.

STRUCTURE — three parts, no headers, no bullet points:
1. HOOK: One sentence showing you know this brand and why you're reaching out specifically.
2. BODY: Who Aastha is and why she's relevant. Lead with her UAE audience quality.
3. ACTION: Soft collaborative close — open a door, not close a deal.

HARD RULES:
- ONLY cite numbers that appear in the STATS block provided. Never invent or round to a bigger figure. If a number is not in STATS, do not state it.
- Zero em dashes. Not one.
- Zero "not just X" constructions. Write what something IS, never what it is NOT.
- Every sentence is a positive statement.
- Zero "if X then Y" logic structures.
- No words: synergy, authentic, leverage, elevate, resonate, curated, align, journey, space, narrative
- No lists or bullet points in the email body
- Under 130 words total
- Sign off as Aastha only
- Warm, forward-looking voice. She says things like "it's always a pleasure working with brands you actually use" — genuine enthusiasm, positive framing.

OUTPUT: Return ONLY valid JSON: {"subject": "...", "body": "..."}. The subject is under 60 characters, specific to the brand, no clickbait. The body is the email text with real line breaks (use \\n).`;

  const userPrompt = `Write a pitch email from Aastha Chopra to a brand manager at ${brandName}.

STATS (the only numbers you may cite):
${factSheet || '- Dubai-based lifestyle creator with an engaged UAE audience'}

Other facts:
- Niches: ${STATIC_PROFILE.niches}
- Based in ${STATIC_PROFILE.location}

${brandNotes ? `Brand context: ${brandNotes}` : `${brandName} is active in the UAE lifestyle market.`}

Hook (why this brand) -> body (her UAE audience quality, using only the STATS above) -> action (open a door).
Return JSON only.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);

  const raw = data.content[0].text.trim();
  // Be forgiving if the model wraps JSON in prose or fences.
  const match = raw.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(match ? match[0] : raw);
    if (parsed.subject && parsed.body) return { subject: parsed.subject.trim(), body: parsed.body.trim() };
  } catch { /* fall through */ }
  // Fallback: treat the whole thing as the body with a generic subject.
  return { subject: `Aastha Chopra x ${brandName} — Dubai creator collab`, body: raw };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Persist a generated pitch so the analytics tab / on-demand "send me this pitch"
 * button can re-deliver it without regenerating, and so we keep an audit trail of
 * exactly which live numbers each pitch quoted.
 */
async function storePitch({ brand, subject, body, score, adData, profile }) {
  const rows = await sb('/brand_pitches', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify([{
      brand_id: brand.id,
      brand_name: brand.name,
      category: brand.category,
      subject,
      body,
      to_email: brand.contact_email || null,
      to_confidence: brand.contact_email ? 'verified' : 'none',
      grounded_stats: profile,
      score,
      ad_count: adData?.count ?? null,
      status: 'draft',
    }]),
  });
  return rows?.[0]?.id ?? null;
}

/**
 * One forward-ready email per brand. The subject IS the pitch subject (so a plain
 * Forward keeps it), the pitch is the clean main body she sends, and a clearly
 * labelled grey banner at the top carries her-eyes-only context she deletes first.
 */
async function sendForwardReadyEmail({ brand, subject, body, score, adData }) {
  const adNote = adData?.active
    ? `Running ${adData.count} active UAE ad${adData.count === 1 ? '' : 's'} right now${adData.recentCount ? ` (${adData.recentCount} new in the last 2 weeks)` : ''}`
    : 'No Meta ad activity detected yet';
  const recipient = brand.contact_email
    ? esc(brand.contact_email)
    : 'find their PR / marketing contact (often the agency that runs their ads)';

  const sig = STATIC_PROFILE;
  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;line-height:1.55">
    <div style="background:#f4f1ea;border:1px solid #e6e0d4;border-radius:10px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#6b6453">
      <strong>For you — delete this box before sending.</strong><br>
      Send to: ${recipient}<br>
      ${esc(brand.category || 'brand')} &middot; fit ${score}/10 &middot; ${adNote}<br>
      Subject is already set below. Forward this email, or copy the pitch.
    </div>
    <div style="white-space:pre-wrap;font-size:15px">${esc(body)}</div>
    <div style="margin-top:18px;padding-top:14px;border-top:1px solid #eee;font-size:14px;color:#333">
      <strong>${esc(sig.name)}</strong><br>
      ${esc(sig.handle)} &middot; ${esc(sig.location)}<br>
      Media pack: <a href="${sig.mediaPackUrl}" style="color:#9a7b2e">${sig.mediaPackUrl.replace('https://www.', '')}</a><br>
      WhatsApp: ${esc(sig.whatsapp)}
    </div>
  </div>`;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: 'Aastha Outreach <onboarding@resend.dev>',
      to: AASTHA_EMAIL,
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend: ${await res.text()}`);
}

export default async function handler(req, res) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).end();
  }

  const brands = await sb('/outreach_brands?is_agency=eq.false&select=*');
  if (!brands.length) {
    return res.status(200).json({ ok: true, note: 'No brands in watchlist' });
  }

  // Ground every pitch in Aastha's real, current Instagram numbers — once per run.
  const profile = await getLiveProfile();

  const today = new Date().toISOString().slice(0, 10);
  const scored = [];

  for (const brand of brands) {
    const adData = await checkAdLibrary(brand.name);
    const score = scoreBrand(brand, adData);

    await sb(`/outreach_brands?id=eq.${brand.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        ad_status: adData?.active ? 'active' : adData === null ? 'unknown' : 'none',
        fit_score: score,
        last_checked: today,
        last_ad_data: adData,
      }),
    });

    scored.push({ brand, adData, score });
    await new Promise(r => setTimeout(r, 300));
  }

  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 3);

  // Generate, store, and deliver one forward-ready pitch per top brand.
  await Promise.all(top.map(async (r) => {
    const { subject, body } = await generatePitch(r.brand.name, profile, r.brand.notes || '');
    r.subject = subject;
    r.body = body;
    r.pitchId = await storePitch({ brand: r.brand, subject, body, score: r.score, adData: r.adData, profile });
    await sendForwardReadyEmail({ brand: r.brand, subject, body, score: r.score, adData: r.adData });
    await sb(`/brand_pitches?id=eq.${r.pitchId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'emailed', emailed_at: new Date().toISOString() }),
    });
  }));

  res.status(200).json({
    ok: true,
    brandsChecked: brands.length,
    emailedTo: AASTHA_EMAIL,
    pitches: top.map((r) => ({ brand: r.brand.name, score: r.score, subject: r.subject })),
    groundedOn: { followers: profile.followers, uaeFollowers: profile.uaeFollowers, uaeReach: profile.uaeReach, asOf: profile.asOf },
  });
}

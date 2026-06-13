/**
 * Shared pitch brain — used by BOTH the daily cron (daily-agent) and the on-demand
 * "send me this pitch" button (pitch-now), so the voice, the grounding rules, and
 * the forward-ready email format never drift between the two paths.
 *
 * Underscore-prefixed so Vercel does NOT expose it as a route.
 */

import { STATIC_PROFILE } from './_profile.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;

/**
 * Build the ONLY stats block a pitch may cite. Every line is a real number pulled
 * live from Instagram, so nothing the model writes can drift from what a brand sees.
 */
export function buildFactSheet(profile) {
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
export async function generatePitch(brandName, profile, brandNotes = '') {
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
  const match = raw.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(match ? match[0] : raw);
    if (parsed.subject && parsed.body) return { subject: parsed.subject.trim(), body: parsed.body.trim() };
  } catch { /* fall through */ }
  return { subject: `Aastha Chopra x ${brandName} — Dubai creator collab`, body: raw };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * The forward-ready HTML: subject is preset by the caller, the pitch is the clean
 * main body she sends, and a clearly-labelled grey banner carries her-eyes-only
 * context she deletes before forwarding.
 */
export function renderPitchEmailHtml({ brand, body, score, adData }) {
  const adNote = adData?.active
    ? `Running ${adData.count} active UAE ad${adData.count === 1 ? '' : 's'} right now${adData.recentCount ? ` (${adData.recentCount} new in the last 2 weeks)` : ''}`
    : 'No Meta ad activity detected yet';
  const recipient = brand.contact_email
    ? esc(brand.contact_email)
    : 'find their PR / marketing contact (often the agency that runs their ads)';
  const sig = STATIC_PROFILE;
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;line-height:1.55">
    <div style="background:#f4f1ea;border:1px solid #e6e0d4;border-radius:10px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#6b6453">
      <strong>For you — delete this box before sending.</strong><br>
      Send to: ${recipient}<br>
      ${esc(brand.category || 'brand')} &middot; fit ${score ?? '—'}/10 &middot; ${adNote}<br>
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
}

/** Send one forward-ready pitch email to a recipient (always Aastha's own inbox). */
export async function sendPitchEmail({ to, brand, subject, body, score, adData }) {
  const html = renderPitchEmailHtml({ brand, body, score, adData });
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: 'Aastha Outreach <onboarding@resend.dev>', to, subject, html }),
  });
  if (!res.ok) throw new Error(`Resend: ${await res.text()}`);
}

// ── Autonomous brand-facing send ─────────────────────────────────────────────
//
// The agent sends the pitch straight to the brand from Aastha's verified domain,
// with replies + a blind copy routed to her management inbox. This path stays
// dormant until OUTREACH_FROM is set to a Resend-verified sender (e.g.
// "Aastha Chopra <management@aasthachopra.com>"); the resend.dev test sender
// can only deliver to the account owner, so autosend self-disables without it.
// OUTREACH_PAUSE=1 is a global kill switch.

const VERIFIED_FROM   = process.env.OUTREACH_FROM || '';
const MANAGEMENT_EMAIL = process.env.MANAGEMENT_EMAIL || 'management@aasthachopra.com';

/** True only when we have a verified sender and the kill switch is off. */
export function autosendEnabled() {
  return process.env.OUTREACH_PAUSE !== '1' && /\S+@\S+/.test(VERIFIED_FROM);
}

/** Clean, brand-facing email — no internal banner, real signature, media pack link. */
export function renderBrandEmailHtml({ body }) {
  const sig = STATIC_PROFILE;
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;line-height:1.6">
    <div style="white-space:pre-wrap;font-size:15px">${esc(body)}</div>
    <div style="margin-top:20px;padding-top:14px;border-top:1px solid #eee;font-size:14px;color:#333">
      <strong>${esc(sig.name)}</strong><br>
      ${esc(sig.handle)} &middot; ${esc(sig.location)}<br>
      Media pack: <a href="${sig.mediaPackUrl}" style="color:#9a7b2e">${sig.mediaPackUrl.replace('https://www.', '')}</a><br>
      WhatsApp: ${esc(sig.whatsapp)}
    </div>
  </div>`;
}

/**
 * Send the pitch directly to the brand. Replies go to Aastha's management inbox,
 * which is also BCC'd so she sees every send. Returns the Resend message id.
 */
export async function sendBrandPitch({ to, subject, body }) {
  if (!autosendEnabled()) throw new Error('autosend disabled (no verified OUTREACH_FROM or paused)');
  const html = renderBrandEmailHtml({ body });
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({
      from: VERIFIED_FROM,
      to,
      bcc: MANAGEMENT_EMAIL,
      reply_to: MANAGEMENT_EMAIL,
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend: ${await res.text()}`);
  const data = await res.json().catch(() => ({}));
  return data?.id ?? null;
}

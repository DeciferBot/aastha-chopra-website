/**
 * Shared pitch brain — used by BOTH the daily cron (daily-agent) and the on-demand
 * "send me this pitch" button (pitch-now), so the voice, the grounding rules, and
 * the forward-ready email format never drift between the two paths.
 *
 * Underscore-prefixed so Vercel does NOT expose it as a route.
 */

import { STATIC_PROFILE } from './_profile.js';
import { VOICE_RULES } from './_accuracy.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;

/**
 * Per-segment CONTENT angle: how Aastha would actually create for this category.
 * The email should be about the work she would make, not the size of her audience,
 * so each angle describes a way of telling the brand's story through her content.
 * (Avoids the banned words; the STATS block still gates any real numbers.)
 */
const SEGMENT_ANGLES = {
  fashion:     'Show how she would style the pieces into real Dubai life so the clothes read as worn and wanted, not just photographed.',
  beauty:      'Show how she would feature the products in honest daily use, the texture and the wear that make a beauty audience trust a recommendation.',
  fragrance:   'Show how she would tell a scent as a feeling and a memory, the kind of storytelling that makes Gulf fragrance lovers want to try it.',
  jewellery:   'Show how she would frame each piece around the moments and occasions it is worn for, so it carries meaning instead of sitting as a product shot.',
  wellness:    'Show how she would fold the brand into a believable daily routine so it reads as part of real life.',
  hospitality: 'Show how she would turn a stay or a meal into something her audience wants to recreate, capturing the feeling of being hosted.',
  travel:      'Show how she would build a destination into a story with a clear arc that makes people save it and plan their own.',
  automobile:  'Show how she would place the car inside an aspirational lifestyle story rather than a list of specs.',
  retail:      'Show how she would make a wide range feel personal and shoppable across everyday city life.',
};

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
  if (profile.coreAge) facts.push(`core audience is ${profile.coreAge} year olds`);
  return facts.map((f) => `- ${f}`).join('\n');
}

/**
 * @returns {Promise<{subject:string, body:string}>}
 */
export async function generatePitch(brandName, profile, brandNotes = '', segment = '', feedback = '') {
  const factSheet = buildFactSheet(profile);
  const angle = SEGMENT_ANGLES[segment] || '';

  const systemPrompt = `You write outreach emails from Aastha Chopra, a Dubai-based lifestyle creator, to brand managers.

WHO SHE IS: A content creator whose real strength is understanding her audience and telling a brand's story well. She is warm, assured, and good at her craft. This email should make a brand feel that she gets them and could bring their work to life. It is not a pitch about reach.

WHAT THE EMAIL IS ABOUT, in order of importance:
1. THE BRAND. Show genuine understanding of what this brand is and what makes it good: its work, its look, what it stands for.
2. HOW SHE WOULD CREATE FOR IT. A concrete, believable picture of how she would feature the brand and tell its story through her content. This is the heart of the email.
3. HER AUTHORITY AS A STORYTELLER. She knows the UAE audience and knows how to show a product so people feel it. Her value is judgment and craft.

STRUCTURE — three short paragraphs, no headers, no bullet points:
1. OPEN: One or two sentences showing you truly know this brand and admire something specific about it.
2. MIDDLE: How she pictures creating with the brand, and why her read on the audience makes that work.
3. CLOSE: A warm, confident invitation to talk.

HARD RULES:
- Do NOT lead with or headline follower counts or audience size. This email is about storytelling and audience understanding, not reach. Leaving numbers out entirely is fine and often better.
- If you reference any number, it must appear verbatim in the STATS block below. Never invent or round up. A number is background, never the selling point.
- Do NOT default to a "South Asian diaspora" framing. Mention it ONLY if the brand context clearly shows the brand has a South Asian line or audience. Otherwise speak to her broad Dubai and UAE lifestyle audience.
- Every sentence is a positive statement. No "if X then Y" logic.
- No lists or bullet points in the body. Under 140 words total.
- Warm and assured. She sounds like someone who loves making content and is good at it.
- Sign off as Aastha only.
${VOICE_RULES}

OUTPUT: Return ONLY a single valid JSON object: {"subject": "...", "body": "..."}. Output nothing else — no markdown code fences, no backticks, no commentary, no corrections, nothing before or after the object, and never more than one object. The subject is under 60 characters and reads like a person wrote it for this one brand: name the idea, not the gesture. NEVER a template like "Bringing X to life" or "X, a story worth telling". The body is the email text with real line breaks between paragraphs (use \\n) and ends with the single sign-off "Aastha".`;

  const userPrompt = `Write a pitch email from Aastha Chopra to a brand manager at ${brandName}.

THE BRAND (the ONLY brand facts you may use; never name a product, collection, campaign, store, event, or award that is not stated here): ${brandNotes
    ? brandNotes
    : `${brandName}, active in the UAE lifestyle market. No further facts are known, so speak only to its category and what brands like it do well. Do not invent particular facts, products, or claims.`}

HOW SHE WOULD CREATE FOR THIS CATEGORY: ${angle || 'Show concretely how she would feature the brand and tell its story through her content.'}

ABOUT AASTHA (background, not the headline):
- Lifestyle creator based in ${STATIC_PROFILE.location}; niches: ${STATIC_PROFILE.niches}.
- Her edge is reading the UAE audience and depicting a product so people feel it.

STATS (the ONLY numbers you may cite, and only if one genuinely strengthens a point; the email should not be about numbers):
${factSheet || '- (no numbers needed; lead with story and craft)'}

Lead with the brand and how she would bring it to life. Treat her audience understanding as the proof of her authority, not a stats dump. Return JSON only.${feedback ? `\n\n${feedback}` : ''}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 700,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);

  const raw = data.content[0].text.trim();
  const parsed = parsePitchResponse(raw);
  if (parsed) return { subject: dedash(parsed.subject), body: dedash(parsed.body) };
  // Never email raw model text: strip any fences/JSON noise for the fallback body.
  return { subject: `Collab idea for ${brandName}`, body: dedash(stripToText(raw)) };
}

/**
 * Hard-enforce the no-em-dash voice rule: the prompt forbids them, but the model
 * still slips one in occasionally (usually in the subject). Replace em/en dashes
 * with a comma so a dash can never reach a brand. Hyphens (e.g. "25-44") are left
 * untouched.
 */
function dedash(s) {
  return String(s).replace(/\s*[—–]\s*/g, ', ');
}

/**
 * Robustly pull {subject, body} from a model reply that may be wrapped in ```json
 * fences, prefixed with commentary, or contain more than one JSON object (e.g. a
 * self-correction). Prefers the content of the last fenced block, then scans for
 * balanced top-level objects and returns the LAST valid one with both fields, so a
 * corrected block always wins over a buggy first attempt. Returns null if none parse.
 */
function parsePitchResponse(raw) {
  let text = raw;
  const fences = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];
  if (fences.length) text = fences[fences.length - 1][1];

  const objects = [];
  let depth = 0, start = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '{') { if (depth === 0) start = i; depth++; }
    else if (c === '}' && depth > 0) { depth--; if (depth === 0 && start >= 0) { objects.push(text.slice(start, i + 1)); start = -1; } }
  }
  for (let i = objects.length - 1; i >= 0; i--) {
    try {
      const p = JSON.parse(objects[i]);
      if (p && p.subject && p.body) return { subject: String(p.subject).trim(), body: String(p.body).trim() };
    } catch { /* try the next candidate */ }
  }
  return null;
}

/** Strip code fences and bare brace lines so a fallback body is never raw JSON noise. */
function stripToText(raw) {
  return raw.replace(/```[\s\S]*?```/g, '').replace(/^\s*[{}]\s*$/gm, '').trim();
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

/**
 * Send one forward-ready pitch email to a recipient (always Aastha's own inbox).
 * Returns the Resend message id so the caller can record it in the pipeline.
 */
export async function sendPitchEmail({ to, brand, subject, body, score, adData }) {
  const html = renderPitchEmailHtml({ brand, body, score, adData });
  // Review/forward path also blind-copies the operator inbox for visibility,
  // mirroring the brand-facing send. OUTREACH_BCC defaults to MANAGEMENT_EMAIL.
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
    body: JSON.stringify({ from: 'Aastha Outreach <hello@aasthachopra.com>', to, bcc: [OUTREACH_BCC, 'chopraa@gmail.com'].filter(Boolean), subject, html }),
  });
  if (!res.ok) throw new Error(`Resend: ${await res.text()}`);
  const data = await res.json().catch(() => ({}));
  return data?.id ?? null;
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
// Replies route here (the creator owns brand conversations).
const MANAGEMENT_EMAIL = process.env.MANAGEMENT_EMAIL || 'management@aasthachopra.com';
// A blind copy of every send goes here so the operator has visibility (separate
// from reply-to). Falls back to the reply-to inbox if unset.
const OUTREACH_BCC     = process.env.OUTREACH_BCC || MANAGEMENT_EMAIL;

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
 * Send the pitch directly to the brand. Replies route to MANAGEMENT_EMAIL (the
 * creator's inbox); a blind copy goes to OUTREACH_BCC (the operator) for
 * visibility. Returns the Resend message id.
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
      bcc: OUTREACH_BCC,
      reply_to: MANAGEMENT_EMAIL,
      subject,
      html,
    }),
  });
  if (!res.ok) throw new Error(`Resend: ${await res.text()}`);
  const data = await res.json().catch(() => ({}));
  return data?.id ?? null;
}

export const config = { maxDuration: 300 };

/**
 * DM Digest — prepares Instagram messages that Aastha sends herself.
 *
 * Picks a few brands whose Instagram handle has been human-verified
 * (outreach_brands.handle_status = 'verified'), writes each a short message in
 * her voice grounded in her actual recent collabs, and emails her ONE digest:
 * per brand, the message text plus a tap-link that opens that brand's chat in
 * the Instagram app (ig.me/m/<handle>). She pastes and sends from her own
 * profile.
 *
 * This code NEVER messages a brand. Instagram forbids automated cold DMs and
 * enforcement risks the account, so the last tap is always hers by design.
 *
 * Hardened 2026-08-31 (code review): one brand's writer/checker error can no
 * longer throw away every other brand's already-verified message in the same
 * run. The audit record is written BEFORE the email goes out, not after — if
 * the record fails to save, nothing is emailed either, so a brand can never
 * end up contacted with no record of it (which used to let the same brand be
 * re-picked and double-messaged on the next run).
 *
 * GET /api/cron/dm-digest[?dryRun=1][&limit=3]
 *   Auth: Bearer CRON_SECRET | MANUAL_SYNC_KEY
 */

import { checkText, VOICE_RULES } from '../_accuracy.js';
import { dedash, esc } from '../_pitch.js';
import { sb, OUTREACH_SEGMENTS, byBudgetThenScore } from '../_outreach-shared.js';
import { STATIC_PROFILE } from '../_profile.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;

const AASTHA_EMAIL  = process.env.OUTREACH_REDIRECT_TO || 'aasthac8@gmail.com';
const OPERATOR_BCC  = process.env.OUTREACH_BCC || 'chopraa@gmail.com';
const COOLDOWN_DAYS = Number(process.env.OUTREACH_COOLDOWN_DAYS || 45);

/**
 * Real, checkable context: brands she tagged in her own captions recently, per
 * segment. A DM that says "I have been creating beauty stories with X and Y"
 * survives the 10 seconds the brand spends checking her profile.
 *
 * Every substring PATTERNS can match has a matching DISPLAY name — a match
 * with no name used to be silently dropped (verified 2026-08-31: Sephora,
 * L'Oréal, Elemis, Maybelline, JWPEI, Offscent, Memoires d'Amour's fragrance
 * cousin brands, and Tanishq all fell through this hole).
 */
function recentCollabsFor(segment, captions) {
  const PATTERNS = {
    beauty:    /@(loccitane|kosas|elemis\w*|sephora\w*|loreal\w*|hudabeauty|maybelline\w*|gisou|diorbeauty)/gi,
    fashion:   /@(zara|jwpei\w*|ounass|ladoublej|acler|alo\b|aloyoga)/gi,
    fragrance: /@(fugazzifragrance|memoiresdamourparfum|louisvuitton|offscent\w*|officialemilelise)/gi,
    jewellery: /@(missoma|tanishq\w*)/gi,
    wellness:  /@(aloyoga|alo\b|caffelinidubai)/gi,
    hospitality: /@(caffelinidubai|trottoirdepalomadxb|gloriaosteria)/gi,
  };
  const re = PATTERNS[segment];
  if (!re) return [];
  const found = new Set();
  for (const c of captions) {
    for (const m of c.matchAll(re)) found.add(m[1].toLowerCase());
  }
  // Handles read like handles; a person names the brand. Unmapped ones are
  // dropped rather than sent raw.
  const DISPLAY = {
    loccitane: "L'Occitane", kosas: 'Kosas', hudabeauty: 'Huda Beauty', gisou: 'Gisou',
    diorbeauty: 'Dior Beauty', zara: 'Zara', ounass: 'Ounass', ladoublej: 'La DoubleJ',
    acler: 'Acler', alo: 'Alo', aloyoga: 'Alo Yoga', fugazzifragrance: 'Fugazzi',
    memoiresdamourparfum: "Memoires d'Amour", louisvuitton: 'Louis Vuitton',
    missoma: 'Missoma', caffelinidubai: 'Caffelini',
    trottoirdepalomadxb: 'Trottoir de Paloma', gloriaosteria: 'Gloria Osteria',
    sephora: 'Sephora', loreal: "L'Oréal", elemis: 'Elemis', maybelline: 'Maybelline',
    jwpei: 'JW PEI', offscent: 'Offscent', officialemilelise: 'Emile Lise',
    tanishq: 'Tanishq',
  };
  const named = [];
  for (const h of found) {
    const base = Object.keys(DISPLAY).find((k) => h.startsWith(k));
    if (base) named.push(DISPLAY[base]);
  }
  return [...new Set(named)].slice(0, 3);
}

/**
 * Generate, then run the shared accuracy engine, up to two attempts. A DM may
 * cite no numbers at all (empty fact sheet). Fails CLOSED: a message that does
 * not pass is never delivered; the brand is skipped this run. Never throws —
 * a writer/checker error is treated as a skip, not a reason to lose every
 * other brand's already-verified message in the same run.
 */
async function generateCheckedDm(brand, collabs) {
  const facts = `BRAND FACTS (the only brand facts that exist): ${brand.brand_brief || brand.notes || `${brand.name} is a ${brand.segment} brand active in the UAE.`}
HER WORK FACTS (the only work references allowed): ${collabs.length ? `she recently featured ${collabs.join(', ')} in her content` : 'none, so the message may not reference any past work'}`;
  let feedback = '';
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const message = await generateDm(brand, collabs, feedback);
      const verdict = await checkText({ text: message, facts, factSheet: '' });
      if (verdict.ok) return { message, attempts: attempt + 1 };
      feedback = `Your previous attempt was rejected: ${verdict.problems.join('; ')}. Fix every one. Only use the supplied facts.`;
    }
  } catch (e) {
    return { message: null, attempts: 0, error: String(e?.message || e) };
  }
  return { message: null, attempts: 2 };
}

async function generateDm(brand, collabs, feedback = '') {
  const sig = STATIC_PROFILE;
  // Structure calibrated 2026-08-31 against a message Aastha actually sent
  // (she rewrote a shorter draft into this shape before sending it) —
  // a proper introduction, not a quick DM.
  const systemPrompt = `You write Instagram messages from Aastha Chopra, a Dubai lifestyle creator, to a brand's Instagram account. The goal is a reply, so it must read like a real person opening a business conversation, never a broadcast.

STRUCTURE, four short paragraphs:
1. GREETING: "Hi [Brand] Team" or "Hi [Brand]," on its own line, then a blank line.
2. INTRODUCTION: one sentence, her name and role, then what she creates and for whom. E.g. "I'm Aastha Chopra, a Dubai-based ${sig.role}, creating content across [her relevant categories] for a predominantly UAE/GCC audience."
3. THE BRAND + THE HOOK: one concrete observation about the brand (from the description below), then one line connecting it to what her audience actually wants in this category (an audience-demand angle, e.g. "my audience is always asking for..."). If she has real work to name, weave it in here too.
4. THE ASK: name concretely what she wants (the right PR/creator-partnerships contact, and being considered for launches, gifting, events), then close with a direct, answerable question inviting a reply.

HARD RULES:
- ACCURACY IS EVERYTHING. Only reference facts that appear in the brand description supplied below. NEVER name a specific product, collection, campaign, or drop that is not in that description. NEVER claim she saw something "in your feed", "last week", or at any specific time or place. If the description is thin, speak to what the brand's category does well, without inventing particulars.
- Mention her recent work ONLY if names are supplied below, using "featured" or "worked around" (she featured them / worked around them in her content). Never say "worked with" or imply a paid deal.
- No numbers, no follower counts, no hashtags. Never the word "collab" (say "work together").
- One or two emoji total, placed naturally (e.g. after the greeting, before the closing question). Never more than two.
- Warm, confident, professional. 100 to 180 words.
- Sign off exactly as:
Aastha x
${sig.website}
${VOICE_RULES}

OUTPUT: only a JSON object {"message": "..."} with real line breaks as \\n, including the blank lines between paragraphs. Nothing else.`;

  const userPrompt = `Brand: ${brand.name} (Instagram ${brand.handle})
What the brand is: ${brand.brand_brief || brand.notes || `${brand.name}, a ${brand.segment} brand active in the UAE.`}
Her relevant content categories for this brand: ${brand.segment}
Her recent ${brand.segment} work she can truthfully name: ${collabs.length ? collabs.join(', ') : '(none supplied, do not invent any)'}${feedback ? `\n\n${feedback}` : ''}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const raw = data.content[0].text.trim();
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const parsed = JSON.parse(m[0]);
      if (parsed.message) return dedash(String(parsed.message).trim());
    } catch { /* fall through to raw */ }
  }
  return dedash(raw.replace(/```[\s\S]*?```/g, '').trim());
}

function renderDigestHtml(items) {
  const blocks = items.map(({ brand, message }) => {
    const handle = String(brand.handle || '').replace(/^@/, '');
    return `
    <div style="border:1px solid #e6e0d4;border-radius:12px;padding:18px;margin-bottom:18px">
      <div style="font-size:16px;font-weight:700;margin-bottom:2px">${esc(brand.name)}</div>
      <div style="font-size:12px;color:#8a8172;margin-bottom:12px">${esc(brand.segment || '')} &middot; ${esc(brand.handle || '')}</div>
      <div style="background:#faf7f1;border:1px solid #eee7d8;border-radius:8px;padding:14px;font-size:15px;line-height:1.55;white-space:pre-wrap">${esc(message)}</div>
      <div style="font-size:12px;color:#8a8172;margin:10px 0 12px">Press and hold the text above to copy it.</div>
      <a href="https://ig.me/m/${esc(handle)}" style="display:inline-block;background:#1a1a1a;color:#faf7f1;text-decoration:none;border-radius:8px;padding:12px 20px;font-size:14px;font-weight:600">Open chat with @${esc(handle)}</a>
    </div>`;
  }).join('');
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;color:#1a1a1a;line-height:1.5">
    <p style="font-size:15px">Three messages, ready to go. For each one: copy the text, tap the button, paste, send. All from your own profile, about a minute in total.</p>
    ${blocks}
    <p style="font-size:12px;color:#8a8172">Every handle here was human-checked before it entered this list. Reply STOP to this email and these digests pause.</p>
  </div>`;
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || '';
  const ok = [process.env.CRON_SECRET, process.env.MANUAL_SYNC_KEY]
    .filter(Boolean).some((k) => auth === `Bearer ${k}`);
  if (!ok) return res.status(401).end();

  const dryRun = req.query?.dryRun === '1' || req.query?.dryrun === '1';
  // `?limit=0` must mean zero, not "unset" — Number('0') || 3 would silently
  // turn a deliberate zero-brand probe into a real 3-brand send.
  const rawLimit = req.query?.limit;
  const parsedLimit = rawLimit !== undefined ? Number(rawLimit) : NaN;
  const limit = Math.min(5, Number.isFinite(parsedLimit) && parsedLimit >= 0 ? parsedLimit : 3);

  try {
    // Brands contacted on ANY channel inside the cooldown window are off-limits.
    // A 'failed' row (nothing actually delivered) does not count.
    const since = new Date(Date.now() - COOLDOWN_DAYS * 864e5).toISOString();
    const recent = await sb(`/brand_pitches?select=brand_name&generated_at=gte.${since}&status=neq.failed`);
    const recentNames = new Set(recent.map((r) => r.brand_name));

    const candidates = (await sb(
      `/outreach_brands?handle_status=eq.verified&is_agency=eq.false` +
      `&budget_tier=eq.major` +
      `&tier=in.(warm,paid)&segment=in.(${OUTREACH_SEGMENTS.join(',')})` +
      `&select=id,name,handle,segment,tier,fit_score,active_ad_count,brand_brief,notes,budget_tier` +
      `&limit=200`
    ))
      .filter((b) => !recentNames.has(b.name))
      .sort((a, b) => byBudgetThenScore(a, b) || ((b.active_ad_count ?? 0) - (a.active_ad_count ?? 0)))
      .slice(0, limit);

    if (!candidates.length) {
      return res.status(200).json({ ok: true, sent: 0, note: 'no eligible verified-handle brands (cooldown or empty list)' });
    }

    // Her last 45 days of captions ground the "recent work" references.
    const posts = await sb(
      `/instagram_posts?select=caption&timestamp=gte.${new Date(Date.now() - 45 * 864e5).toISOString()}&limit=60`
    );
    const captions = posts.map((p) => p.caption || '');

    const items = [];
    const skipped = [];
    for (const brand of candidates) {
      const collabs = recentCollabsFor(brand.segment, captions);
      const { message, attempts, error } = await generateCheckedDm(brand, collabs);
      if (message) items.push({ brand, message, attempts });
      else skipped.push(error ? { name: brand.name, reason: error } : brand.name);
    }

    if (dryRun) {
      return res.status(200).json({
        ok: true, status: 'dry-run', skipped,
        items: items.map(({ brand, message, attempts }) => ({ name: brand.name, handle: brand.handle, attempts, message })),
      });
    }

    if (!items.length) {
      return res.status(200).json({ ok: true, sent: 0, skipped, note: 'every candidate failed the accuracy checks; nothing delivered' });
    }

    // Record BEFORE sending: if the record never saves, the email never goes
    // out either, so a brand can't end up messaged with no memory of it (the
    // old order let a send succeed, the record fail, and the same brand get
    // picked and messaged again next run).
    await sb('/brand_pitches', {
      method: 'POST',
      body: JSON.stringify(items.map(({ brand, message }) => ({
        brand_id: brand.id,
        brand_name: brand.name,
        category: brand.segment,
        subject: `IG DM to ${brand.handle}`,
        body: message,
        to_email: null,
        to_confidence: 'ig_handle_verified',
        status: 'dm',
      }))),
    });

    const html = renderDigestHtml(items);
    const mail = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_KEY}` },
      body: JSON.stringify({
        from: 'Aastha Outreach <hello@aasthachopra.com>',
        to: AASTHA_EMAIL,
        bcc: OPERATOR_BCC,
        subject: `${items.length} Instagram messages, ready to send`,
        html,
      }),
    });
    if (!mail.ok) throw new Error(`Resend: ${await mail.text()}`);

    return res.status(200).json({ ok: true, sent: items.length, skipped, brands: items.map((i) => i.brand.name) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

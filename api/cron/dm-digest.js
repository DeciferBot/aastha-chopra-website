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
 * GET /api/cron/dm-digest[?dryRun=1][&limit=3]
 *   Auth: Bearer CRON_SECRET | MANUAL_SYNC_KEY
 */

import { checkText } from '../_accuracy.js';

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;

const AASTHA_EMAIL  = process.env.OUTREACH_REDIRECT_TO || 'aasthac8@gmail.com';
const OPERATOR_BCC  = process.env.OUTREACH_BCC || 'chopraa@gmail.com';
const COOLDOWN_DAYS = Number(process.env.OUTREACH_COOLDOWN_DAYS || 45);

const DM_SEGMENTS = ['beauty', 'fashion', 'fragrance', 'jewellery', 'wellness'];

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

/** Em/en dashes never reach a brand, mirroring the pitch brain's voice rule. */
function dedash(s) {
  return String(s).replace(/\s*[—–]\s*/g, ', ');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Real, checkable context: brands she tagged in her own captions recently, per
 * segment. A DM that says "I have been creating beauty stories with X and Y"
 * survives the 10 seconds the brand spends checking her profile.
 */
function recentCollabsFor(segment, captions) {
  const PATTERNS = {
    beauty:    /@(loccitane|kosas|elemis\w*|sephora\w*|loreal\w*|hudabeauty|maybelline\w*|gisou|diorbeauty)/gi,
    fashion:   /@(zara|jwpei\w*|ounass|ladoublej|acler|alo\b|aloyoga)/gi,
    fragrance: /@(fugazzifragrance|memoiresdamourparfum|louisvuitton|offscent\w*|officialemilelise)/gi,
    jewellery: /@(missoma|tanishq\w*)/gi,
    wellness:  /@(aloyoga|alo\b|caffelinidubai)/gi,
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
 * not pass is never delivered; the brand is skipped this run.
 */
async function generateCheckedDm(brand, collabs) {
  const facts = `BRAND FACTS (the only brand facts that exist): ${brand.brand_brief || brand.notes || `${brand.name} is a ${brand.segment} brand active in the UAE.`}
HER WORK FACTS (the only work references allowed): ${collabs.length ? `she recently featured ${collabs.join(', ')} in her content` : 'none, so the message may not reference any past work'}`;
  let feedback = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const message = await generateDm(brand, collabs, feedback);
    const verdict = await checkText({ text: message, facts, factSheet: '' });
    if (verdict.ok) return { message, attempts: attempt + 1 };
    feedback = `Your previous attempt was rejected: ${verdict.problems.join('; ')}. Fix every one. Only use the supplied facts.`;
  }
  return { message: null, attempts: 2 };
}

async function generateDm(brand, collabs, feedback = '') {
  const systemPrompt = `You write short Instagram direct messages from Aastha Chopra, a Dubai lifestyle creator, to a brand's Instagram account. The goal is a reply, so the message must read like a person, never a broadcast.

HARD RULES:
- 40 to 70 words. Two short paragraphs at most.
- The FIRST sentence must be specific to this brand (it is all they see in the request preview). Never open with "Hi" alone, her own name, or "I am a creator".
- ACCURACY IS EVERYTHING. Only reference facts that appear in the brand description supplied below. NEVER name a specific product, collection, campaign, or drop that is not in that description. NEVER claim she saw something "in your feed", "last week", or at any specific time or place. If the description is thin, speak to what the brand's category does well, without inventing particulars.
- Show one genuine observation about the brand (from the description), then one line on what she would love to create with them, then a light question that invites a reply.
- Mention her recent work ONLY if names are supplied below, using the word "featured" (she featured them in her content). Never say "worked with" or imply a paid deal.
- No numbers, no follower counts, no links, no hashtags.
- Zero em dashes. Banned words: authentic, elevate, resonate, curated, align, journey, collab (use "work together"), synergy.
- Warm, confident, a little playful. Sounds typed on a phone, not mailed.
- End with "Aastha x" on its own line.

OUTPUT: only a JSON object {"message": "..."} with real line breaks as \\n. Nothing else.`;

  const userPrompt = `Brand: ${brand.name} (Instagram ${brand.handle})
What the brand is: ${brand.brand_brief || brand.notes || `${brand.name}, a ${brand.segment} brand active in the UAE.`}
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
  const limit = Math.min(5, Number(req.query?.limit) || 3);

  try {
    // Brands contacted on ANY channel inside the cooldown window are off-limits.
    const since = new Date(Date.now() - COOLDOWN_DAYS * 864e5).toISOString();
    const recent = await sb(`/brand_pitches?select=brand_name&generated_at=gte.${since}`);
    const recentNames = new Set(recent.map((r) => r.brand_name));

    const candidates = (await sb(
      `/outreach_brands?handle_status=eq.verified&is_agency=eq.false` +
      `&tier=in.(warm,paid)&segment=in.(${DM_SEGMENTS.join(',')})` +
      `&select=id,name,handle,segment,tier,fit_score,active_ad_count,brand_brief,notes` +
      `&order=fit_score.desc.nullslast,active_ad_count.desc.nullslast&limit=60`
    )).filter((b) => !recentNames.has(b.name)).slice(0, limit);

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
      const { message, attempts } = await generateCheckedDm(brand, collabs);
      if (message) items.push({ brand, message, attempts });
      else skipped.push(brand.name);
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

    return res.status(200).json({ ok: true, sent: items.length, skipped, brands: items.map((i) => i.brand.name) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

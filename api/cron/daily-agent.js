/**
 * Daily Outreach Agent — Vercel Cron
 * Runs at 2:00 UTC (6:00 AM UAE time) every day.
 * Scores brands, generates pitches for top 3, emails digest to Aastha.
 * GET /api/cron/daily-agent
 */

const SUPABASE_URL  = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const FB_TOKEN      = process.env.FB_ACCESS_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const AASTHA_EMAIL  = 'aasthac8@gmail.com';

const PROFILE = {
  name: 'Aastha Chopra',
  handle: '@aastha_sochic',
  followers: 51552,
  uaeReach: 28893,
  topAge: '18-34',
  niches: 'lifestyle, fashion, beauty, fitness',
  whatsapp: '+97153646723',
  mediaPackUrl: 'https://www.aasthachopra.com/Aastha_Chopra_Media_Pack.pdf',
  location: 'Dubai, UAE',
};

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

async function generatePitch(brandName, brandNotes = '') {
  const systemPrompt = `You write outreach emails from Aastha Chopra, a Dubai-based lifestyle creator, to brand managers.

VOICE: Confident, warm, direct. Reads like a real person wrote it — not a template, not a tool.

STRUCTURE — three parts, no headers, no bullet points:
1. HOOK: One sentence showing you know this brand and why you're reaching out specifically.
2. BODY: Who Aastha is and why she's relevant. Lead with Dubai reach and UAE audience quality.
3. ACTION: Soft collaborative close — open a door, not close a deal.

HARD RULES:
- Zero em dashes. Not one.
- Zero "not just X" constructions. Write what something IS, never what it is NOT.
- Every sentence is a positive statement.
- Zero "if X then Y" logic structures.
- No words: synergy, authentic, leverage, elevate, resonate, curated, align, journey, space, narrative
- No lists or bullet points in the email body
- Under 130 words total
- Sign off as Aastha only
- Aastha's voice is warm and forward-looking. She says things like "it's always a pleasure working with brands you actually use" — genuine enthusiasm, positive framing.`;

  const userPrompt = `Write a pitch email from Aastha Chopra to a brand manager at ${brandName}.

About Aastha:
- Dubai-based lifestyle creator, ${PROFILE.followers.toLocaleString()} Instagram followers
- ${PROFILE.uaeReach.toLocaleString()} people reached monthly across Dubai, Abu Dhabi and Sharjah
- Audience is ${PROFILE.topAge} year olds, strong South Asian diaspora in UAE
- Niches: ${PROFILE.niches}
- WhatsApp: ${PROFILE.whatsapp}
- Media pack: ${PROFILE.mediaPackUrl}

${brandNotes ? `Brand context: ${brandNotes}` : `${brandName} is active in the UAE lifestyle market.`}

Write the email. Hook (why this brand) → body (Aastha's UAE reach and audience quality) → action (open a door).
No lists. No em dashes. Human voice.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data.content[0].text;
}

async function sendDigestEmail(top) {
  const date = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Dubai',
  });

  const pitchSections = top.map((r, i) => {
    const adNote = r.adData?.active
      ? `Currently running ${r.adData.count} active UAE ads${r.adData.recentCount ? ` (${r.adData.recentCount} in the last 2 weeks)` : ''}.`
      : 'No Meta ad activity detected yet.';

    return [
      `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      `#${i + 1} — ${r.brand.name} (${r.score}/10)`,
      `Category: ${r.brand.category}`,
      `Score reason: ${r.brand.niche_fit} niche fit. ${adNote}`,
      `Send to: ${r.brand.contact_email || '(find contact email)'}`,
      ``,
      r.pitch,
    ].join('\n');
  }).join('\n\n');

  const body = [
    `Good morning Aastha,`,
    ``,
    `Here are your top 3 brand opportunities for ${date}.`,
    `Copy each pitch and send from management@aasthachopra.com`,
    ``,
    pitchSections,
    ``,
    `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `See you tomorrow,`,
    `Outreach Bot`,
  ].join('\n');

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_KEY}`,
    },
    body: JSON.stringify({
      from: 'Outreach Bot <onboarding@resend.dev>',
      to: AASTHA_EMAIL,
      subject: `Your top 3 brand pitches — ${date}`,
      text: body,
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

  // Generate pitches for top 3 in parallel
  await Promise.all(top.map(async (r) => {
    r.pitch = await generatePitch(r.brand.name, r.brand.notes || '');
  }));

  await sendDigestEmail(top);

  res.status(200).json({ ok: true, brandsChecked: brands.length, emailedTo: AASTHA_EMAIL });
}

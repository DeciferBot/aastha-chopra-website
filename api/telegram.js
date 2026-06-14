/**
 * Telegram Webhook Handler
 * Receives updates from Telegram and routes commands.
 * POST /api/telegram
 */

const SUPABASE_URL  = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY   = process.env.SUPABASE_SERVICE_KEY;
const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_IDS   = (process.env.TELEGRAM_ALLOWED_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RESEND_KEY    = process.env.RESEND_API_KEY;
const AASTHA_EMAIL  = 'aasthac8@gmail.com';
const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── Email via Resend ───────────────────────────────────────────────────────────
async function emailPitchToAastha(brandName, pitchBody, brandEmail) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_KEY}`,
    },
    body: JSON.stringify({
      from: 'Outreach Bot <hello@aasthachopra.com>',
      to: AASTHA_EMAIL,
      subject: `Pitch ready: ${brandName} → ${brandEmail || 'find email'}`,
      text: [
        `Hi Aastha,`,
        ``,
        `Here is your pitch for ${brandName}.`,
        `Send it to: ${brandEmail || '(find the contact email)'}`,
        ``,
        `---`,
        ``,
        pitchBody,
        ``,
        `---`,
        ``,
        `Copy the pitch above and send from management@aasthachopra.com`,
      ].join('\n'),
    }),
  });
}

// ── Telegram ───────────────────────────────────────────────────────────────────
async function send(chatId, text, useMarkdown = true) {
  await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...(useMarkdown ? { parse_mode: 'Markdown' } : {}),
    }),
  });
}

// ── Supabase helpers ───────────────────────────────────────────────────────────
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
  if (!res.ok) throw new Error(`Supabase error: ${await res.text()}`);
  return res.json();
}

// ── Profile (static for now, can move to Supabase later) ──────────────────────
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

// ── Pitch writer ───────────────────────────────────────────────────────────────
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

// ── Command handlers ───────────────────────────────────────────────────────────
async function handleAdd(chatId, args) {
  const name = args.replace(/^@/, '').trim();
  if (!name) return send(chatId, '❌ Usage: `add BrandName`');

  try {
    await sb('/outreach_brands', {
      method: 'POST',
      body: JSON.stringify({ name, handle: name.startsWith('@') ? name : null }),
    });
    send(chatId, `✅ Added *${name}* to watchlist.`);
  } catch (e) {
    if (e.message.includes('duplicate') || e.message.includes('unique')) {
      send(chatId, `⚠️ *${name}* is already on the watchlist.`);
    } else {
      send(chatId, `❌ Could not add *${name}*: ${e.message}`);
    }
  }
}

async function handleRemove(chatId, args) {
  const name = args.trim();
  await sb(`/outreach_brands?name=eq.${encodeURIComponent(name)}`, { method: 'DELETE' });
  send(chatId, `🗑 Removed *${name}* from watchlist.`);
}

async function handleList(chatId) {
  const brands = await sb('/outreach_brands?is_agency=eq.false&order=fit_score.desc.nullslast,name.asc&select=name,category,fit_score,ad_status');
  if (!brands.length) return send(chatId, '📋 Watchlist is empty. Add brands with `add BrandName`');

  const lines = brands.map((b, i) => {
    const dot = b.ad_status === 'active' ? '🟢' : b.ad_status === 'none' ? '⚪' : '🔵';
    const score = b.fit_score ? ` · ${b.fit_score}/10` : '';
    return `${dot} ${b.name}${score}`;
  });

  send(chatId, `📋 *${brands.length} brands on watchlist*\n\n${lines.join('\n')}\n\n🟢 Active UAE ads · 🔵 Not yet checked`);
}

async function handleStatus(chatId) {
  const contacts = await sb('/outreach_pipeline?select=status,opens');
  const total   = contacts.length;
  const queued  = contacts.filter(c => c.status === 'queued').length;
  const sent    = contacts.filter(c => c.status === 'sent').length;
  const opened  = contacts.filter(c => c.opens > 0).length;
  const warm    = contacts.filter(c => c.opens >= 2).length;
  const replied = contacts.filter(c => c.status === 'replied').length;
  const deal    = contacts.filter(c => c.status === 'deal').length;

  send(chatId, [
    `📊 *Pipeline Summary*`,
    ``,
    `Total pitches: ${total}`,
    `📥 Queued (awaiting your forward): ${queued}`,
    `📨 Sent to brand: ${sent}`,
    `👀 Opened: ${opened}`,
    `🔥 Warm (2+ opens): ${warm}`,
    `💬 Replied: ${replied}`,
    `🤝 Deals: ${deal}`,
  ].join('\n'));
}

async function handleLeads(chatId) {
  // Open inbound briefs only — real leads awaiting a reply (test rows excluded).
  const leads = await sb('/contact_briefs?status=eq.new&order=created_at.desc&select=brand,email,category,budget,collab_type,message,created_at');
  if (!leads.length) return send(chatId, '📥 No open inbound leads. You are all caught up.');

  const blocks = leads.map((l) => {
    const date = (l.created_at || '').slice(0, 10);
    const budget = l.budget ? l.budget : 'not specified';
    const msg = (l.message || '').replace(/\s+/g, ' ').slice(0, 220);
    return [
      `🟡 ${l.brand}  (${date})`,
      `${l.collab_type || 'collab'} · ${l.category || '—'} · budget: ${budget}`,
      `reply to: ${l.email || '—'}`,
      msg ? `“${msg}”` : '',
      `mark done: done ${l.brand}`,
    ].filter(Boolean).join('\n');
  });

  send(chatId, `📥 ${leads.length} open inbound lead${leads.length === 1 ? '' : 's'}\n\n${blocks.join('\n\n')}`, false);
}

async function handleLeadDone(chatId, args) {
  const name = args.trim();
  if (!name) return send(chatId, '❌ Usage: done BrandName', false);
  const updated = await sb(
    `/contact_briefs?status=eq.new&brand=ilike.${encodeURIComponent('%' + name + '%')}`,
    { method: 'PATCH', body: JSON.stringify({ status: 'replied', handled_at: new Date().toISOString() }) },
  );
  if (!updated.length) return send(chatId, `⚠️ No open lead matching “${name}”. Type \`leads\` to see them.`);
  send(chatId, `✅ Marked ${updated.map((u) => u.brand).join(', ')} as replied.`, false);
}

async function handlePitch(chatId, args) {
  const brandName = args.trim();
  if (!brandName) return send(chatId, '❌ Usage: `pitch BrandName`');

  await send(chatId, `🔍 Researching *${brandName}* and writing pitch...`);

  try {
    const brands = await sb(`/outreach_brands?name=ilike.${encodeURIComponent(brandName)}&select=notes,contact_email`);
    const brand = brands[0] || {};
    const pitchBody = await generatePitch(brandName, brand.notes || '');
    const brandEmail = brand.contact_email || null;

    await emailPitchToAastha(brandName, pitchBody, brandEmail);

    await send(chatId, `✅ Pitch for *${brandName}* sent to your Gmail.\n\nForward it to: \`${brandEmail || 'find contact email'}\``);
  } catch (e) {
    send(chatId, `❌ Failed: ${e.message}`);
  }
}

async function handleHelp(chatId) {
  send(chatId, [
    `🤖 *Aastha Outreach Bot*`,
    ``,
    `\`add BrandName\` — add brand to watchlist`,
    `\`remove BrandName\` — remove brand`,
    `\`list\` — show watchlist`,
    `\`pitch BrandName\` — generate pitch now`,
    `\`leads\` — open inbound brand enquiries`,
    `\`done BrandName\` — mark an inbound lead replied`,
    `\`status\` — pipeline summary`,
    `\`help\` — this message`,
    ``,
    `Daily digest arrives at 9am UAE time.`,
  ].join('\n'));
}

// ── Main handler ───────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const update = req.body;
  const msg = update?.message;
  if (!msg) return res.status(200).end();

  const chatId = msg.chat.id;
  const userId = String(msg.from?.id);

  if (ALLOWED_IDS.length && !ALLOWED_IDS.includes(userId)) {
    return res.status(200).end();
  }

  const text = (msg.text || '').trim();
  const lower = text.toLowerCase();
  const [cmd, ...rest] = lower.split(' ');
  const args = rest.join(' ');
  const originalArgs = text.split(' ').slice(1).join(' ');

  try {
    if (cmd === 'add')         await handleAdd(chatId, originalArgs);
    else if (cmd === 'remove') await handleRemove(chatId, originalArgs);
    else if (cmd === 'list')   await handleList(chatId);
    else if (cmd === 'status') await handleStatus(chatId);
    else if (cmd === 'leads')  await handleLeads(chatId);
    else if (cmd === 'done')   await handleLeadDone(chatId, originalArgs);
    else if (cmd === 'pitch')  await handlePitch(chatId, originalArgs);
    else if (cmd === '/start' || cmd === 'help' || cmd === '/help') await handleHelp(chatId);
    else if (text.startsWith('@')) await handleAdd(chatId, text);
    else await send(chatId, `❓ Unknown command. Type \`help\` for the list.`);
  } catch (e) {
    console.error('Handler error:', e);
    await send(chatId, `❌ Something went wrong. Try again.`);
  }

  res.status(200).end();
}

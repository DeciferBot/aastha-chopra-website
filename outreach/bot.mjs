/**
 * Aastha Outreach Bot — Telegram interface
 *
 * Commands:
 *   add @handle or add BrandName   — add brand to watchlist
 *   remove BrandName               — remove brand
 *   list                           — show watchlist
 *   pitch BrandName                — manual research + draft pitch now
 *   status                         — pipeline summary
 *   help                           — command list
 *
 * Run: node outreach/bot.mjs
 */

import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ── Config ─────────────────────────────────────────────────────────────────────
const env = {};
try {
  readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=["']?(.+?)["']?\s*$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
} catch {}

const BOT_TOKEN   = env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_IDS = (env.TELEGRAM_ALLOWED_IDS || process.env.TELEGRAM_ALLOWED_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

const API = `https://api.telegram.org/bot${BOT_TOKEN}`;

const BRANDS_FILE  = resolve(__dirname, 'brands.json');
const PIPELINE_FILE = resolve(__dirname, 'pipeline.json');
const PROFILE_FILE = resolve(__dirname, 'profile.json');

// ── Telegram helpers ───────────────────────────────────────────────────────────
async function tgGet(method, params = {}) {
  const url = new URL(`${API}/${method}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url);
  return res.json();
}

async function send(chatId, text, extra = {}) {
  await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown', ...extra }),
  });
}

// ── Data helpers ───────────────────────────────────────────────────────────────
function loadBrands() {
  try { return JSON.parse(readFileSync(BRANDS_FILE, 'utf8')); }
  catch { return { watchlist: [] }; }
}

function saveBrands(data) {
  writeFileSync(BRANDS_FILE, JSON.stringify(data, null, 2));
}

function loadPipeline() {
  try { return JSON.parse(readFileSync(PIPELINE_FILE, 'utf8')); }
  catch { return { contacts: [] }; }
}

function loadProfile() {
  return JSON.parse(readFileSync(PROFILE_FILE, 'utf8'));
}

// ── Command handlers ───────────────────────────────────────────────────────────
async function handleAdd(chatId, args) {
  const name = args.replace(/^@/, '').trim();
  if (!name) return send(chatId, '❌ Usage: `add BrandName` or `add @handle`');

  const data = loadBrands();
  const exists = data.watchlist.find(b => b.name.toLowerCase() === name.toLowerCase());
  if (exists) return send(chatId, `⚠️ *${name}* is already on your watchlist.`);

  data.watchlist.push({
    name,
    handle: name.startsWith('@') ? name : null,
    addedAt: new Date().toISOString().slice(0, 10),
    adStatus: null,
    fitScore: null,
    lastChecked: null,
  });
  saveBrands(data);
  send(chatId, `✅ Added *${name}* to watchlist. I'll check their UAE ad status in the next daily run.`);
}

async function handleRemove(chatId, args) {
  const name = args.trim();
  const data = loadBrands();
  const before = data.watchlist.length;
  data.watchlist = data.watchlist.filter(b => b.name.toLowerCase() !== name.toLowerCase());
  if (data.watchlist.length === before) return send(chatId, `❌ *${name}* not found on watchlist.`);
  saveBrands(data);
  send(chatId, `🗑 Removed *${name}* from watchlist.`);
}

async function handleList(chatId) {
  const data = loadBrands();
  if (!data.watchlist.length) {
    return send(chatId, '📋 Watchlist is empty. Add brands with `add BrandName`');
  }
  const lines = data.watchlist.map((b, i) => {
    const status = b.adStatus === 'active' ? '🟢' : b.adStatus === 'none' ? '⚪' : '❓';
    const score = b.fitScore ? ` · Score ${b.fitScore}/10` : '';
    return `${status} ${i + 1}. *${b.name}*${score}`;
  });
  send(chatId, `📋 *Watchlist (${data.watchlist.length} brands)*\n\n${lines.join('\n')}\n\n🟢 Active UAE ads · ⚪ No ads · ❓ Not checked`);
}

async function handleStatus(chatId) {
  const pipeline = loadPipeline();
  const contacts = pipeline.contacts || [];

  const counts = {
    total:    contacts.length,
    sent:     contacts.filter(c => c.status === 'sent').length,
    opened:   contacts.filter(c => c.opens > 0).length,
    warm:     contacts.filter(c => c.opens >= 2).length,
    replied:  contacts.filter(c => c.status === 'replied').length,
    deal:     contacts.filter(c => c.status === 'deal').length,
  };

  const msg = [
    `📊 *Pipeline Summary*`,
    ``,
    `Total contacted: ${counts.total}`,
    `📨 Emails sent: ${counts.sent}`,
    `👀 Opened: ${counts.opened}`,
    `🔥 Warm (2+ opens): ${counts.warm}`,
    `💬 Replied: ${counts.replied}`,
    `🤝 Deals: ${counts.deal}`,
  ].join('\n');

  send(chatId, msg);
}

async function handlePitch(chatId, args) {
  const brand = args.trim();
  if (!brand) return send(chatId, '❌ Usage: `pitch BrandName`');
  send(chatId, `🔍 Researching *${brand}*... I'll have a draft pitch ready in a moment.`);

  // Import and run pitch writer
  try {
    const { generatePitch } = await import('./pitch-writer.mjs');
    const pitch = await generatePitch(brand);
    await send(chatId, `📝 *Draft pitch for ${brand}:*\n\`\`\`\n${pitch.email}\n\`\`\``);
    await send(chatId, `Send to: ${pitch.email_to || 'unknown — find contact first'}\n\nReply *send* to send, *edit <change>* to adjust, *skip* to discard.`);
  } catch (e) {
    send(chatId, `❌ Pitch generation failed: ${e.message}`);
  }
}

async function handleHelp(chatId) {
  const msg = [
    `🤖 *Aastha Outreach Bot*`,
    ``,
    `*Commands:*`,
    `\`add BrandName\` — add to watchlist`,
    `\`remove BrandName\` — remove from watchlist`,
    `\`list\` — show watchlist with ad status`,
    `\`pitch BrandName\` — generate pitch now`,
    `\`status\` — pipeline summary`,
    `\`help\` — this message`,
    ``,
    `The daily agent runs automatically at 6am UAE time.`,
    `You'll get a morning digest with today's top opportunities.`,
  ].join('\n');
  send(chatId, msg);
}

// ── Message router ─────────────────────────────────────────────────────────────
async function handleMessage(msg) {
  const chatId = msg.chat.id;
  const userId = String(msg.from?.id);
  const text = (msg.text || '').trim().toLowerCase();

  // Security: only respond to allowed users
  if (ALLOWED_IDS.length && !ALLOWED_IDS.includes(userId)) {
    return send(chatId, '🔒 Unauthorised.');
  }

  const [cmd, ...rest] = text.split(' ');
  const args = rest.join(' ');

  switch (cmd) {
    case 'add':    return handleAdd(chatId, args);
    case 'remove': return handleRemove(chatId, args);
    case 'list':   return handleList(chatId);
    case 'status': return handleStatus(chatId);
    case 'pitch':  return handlePitch(chatId, args);
    case 'help':
    case '/start':
    case '/help':  return handleHelp(chatId);
    default:
      // If it looks like a brand name without a command, treat as "add"
      if (text.startsWith('@')) return handleAdd(chatId, text);
      return send(chatId, `❓ Unknown command. Type \`help\` for the command list.`);
  }
}

// ── Polling loop ───────────────────────────────────────────────────────────────
async function poll() {
  if (!BOT_TOKEN) {
    console.error('❌ TELEGRAM_BOT_TOKEN not set in .env.local');
    process.exit(1);
  }

  console.log('🤖 Aastha Outreach Bot started');
  console.log(`   Allowed users: ${ALLOWED_IDS.length ? ALLOWED_IDS.join(', ') : 'all (set TELEGRAM_ALLOWED_IDS to restrict)'}`);

  let offset = 0;
  while (true) {
    try {
      const { result } = await tgGet('getUpdates', { offset, timeout: 30 });
      for (const update of result || []) {
        offset = update.update_id + 1;
        if (update.message) {
          handleMessage(update.message).catch(e => console.error('Handler error:', e.message));
        }
      }
    } catch (e) {
      console.error('Poll error:', e.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

poll();

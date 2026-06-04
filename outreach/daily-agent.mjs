/**
 * Daily Outreach Agent
 *
 * 1. Reads brand watchlist
 * 2. Checks Meta Ad Library for active UAE ads per brand
 * 3. Scores each brand (0-10)
 * 4. Sends Telegram digest for top opportunities
 * 5. Flags urgent brands (score 7+) immediately
 *
 * Run manually:  node outreach/daily-agent.mjs
 * Scheduled:     cron "0 6 * * *" in UAE timezone (UTC+4 → "0 2 * * *" UTC)
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

const BOT_TOKEN      = env.TELEGRAM_BOT_TOKEN    || process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID        = env.TELEGRAM_CHAT_ID       || process.env.TELEGRAM_CHAT_ID;
const FB_ACCESS_TOKEN = env.FB_ACCESS_TOKEN       || process.env.FB_ACCESS_TOKEN;
const API            = `https://api.telegram.org/bot${BOT_TOKEN}`;

const BRANDS_FILE    = resolve(__dirname, 'brands.json');
const PIPELINE_FILE  = resolve(__dirname, 'pipeline.json');

// ── Helpers ────────────────────────────────────────────────────────────────────
async function sendTg(text) {
  if (!BOT_TOKEN || !CHAT_ID) {
    console.log('[TG]', text);
    return;
  }
  await fetch(`${API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'Markdown' }),
  });
}

function loadBrands() {
  try { return JSON.parse(readFileSync(BRANDS_FILE, 'utf8')); }
  catch { return { watchlist: [] }; }
}
function saveBrands(data) { writeFileSync(BRANDS_FILE, JSON.stringify(data, null, 2)); }

function loadPipeline() {
  try { return JSON.parse(readFileSync(PIPELINE_FILE, 'utf8')); }
  catch { return { contacts: [] }; }
}

// ── Meta Ad Library check ──────────────────────────────────────────────────────
async function checkAdLibrary(brandName) {
  if (!FB_ACCESS_TOKEN) {
    console.warn(`  ⚠ FB_ACCESS_TOKEN not set — skipping Ad Library check for ${brandName}`);
    return null;
  }

  try {
    const params = new URLSearchParams({
      search_terms: brandName,
      ad_type: 'ALL',
      ad_reached_countries: '["AE"]',
      ad_active_status: 'ACTIVE',
      limit: '10',
      fields: 'id,page_name,ad_creative_bodies,ad_delivery_start_time,ad_snapshot_url',
      access_token: FB_ACCESS_TOKEN,
    });

    const res = await fetch(`https://graph.facebook.com/v21.0/ads_archive?${params}`);
    const data = await res.json();

    if (data.error) {
      console.warn(`  ⚠ Ad Library error for ${brandName}: ${data.error.message}`);
      return null;
    }

    const ads = data.data || [];
    if (!ads.length) return { active: false, count: 0, ads: [] };

    // Check recency — ads started in last 14 days score higher
    const now = Date.now();
    const recentAds = ads.filter(ad => {
      if (!ad.ad_delivery_start_time) return false;
      const started = new Date(ad.ad_delivery_start_time).getTime();
      return (now - started) < 14 * 24 * 60 * 60 * 1000;
    });

    // Detect UGC/lifestyle creative style from body text
    const isUgcStyle = ads.some(ad => {
      const body = (ad.ad_creative_bodies || []).join(' ').toLowerCase();
      return body.includes('lifestyle') || body.includes('creator') || body.includes('collab') ||
             body.includes('influencer') || body.includes('try') || body.includes('love');
    });

    return {
      active: true,
      count: ads.length,
      recentCount: recentAds.length,
      isUgcStyle,
      oldestPage: ads[0]?.page_name || brandName,
      ads,
    };
  } catch (e) {
    console.error(`  Ad Library fetch failed for ${brandName}:`, e.message);
    return null;
  }
}

// ── Scoring ────────────────────────────────────────────────────────────────────
function scoreBrand(brand, adData) {
  let score = 0;
  const reasons = [];

  if (adData?.active) {
    score += 3;
    reasons.push('running UAE ads');
  }
  if (adData?.recentCount > 0) {
    score += 2;
    reasons.push(`${adData.recentCount} new ads in last 14 days`);
  }
  if (adData?.isUgcStyle) {
    score += 2;
    reasons.push('UGC/lifestyle creative style');
  }
  if (brand.hasBioEmail) {
    score += 1;
    reasons.push('collab email in bio');
  }

  // Niche fit (set when brand is added manually or via research)
  if (brand.nicheFit === 'high') { score += 2; reasons.push('strong niche fit'); }
  else if (brand.nicheFit === 'medium') { score += 1; reasons.push('moderate niche fit'); }

  return { score: Math.min(score, 10), reasons };
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🌅 Daily outreach agent starting...\n');

  const { watchlist } = loadBrands();
  if (!watchlist.length) {
    console.log('⚠ Watchlist is empty. Add brands via Telegram: "add BrandName"');
    await sendTg('⚠️ Your brand watchlist is empty. Add brands with `add BrandName`');
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const results = [];

  console.log(`Checking ${watchlist.length} brands against Meta Ad Library (UAE)...\n`);

  for (const brand of watchlist) {
    process.stdout.write(`  Checking ${brand.name}... `);
    const adData = await checkAdLibrary(brand.name);
    const { score, reasons } = scoreBrand(brand, adData);

    brand.adStatus = adData?.active ? 'active' : adData === null ? 'unknown' : 'none';
    brand.fitScore = score;
    brand.lastChecked = today;
    brand.lastAdData = adData;

    console.log(`score ${score}/10 ${adData?.active ? '🟢' : '⚪'}`);
    results.push({ brand, adData, score, reasons });

    await new Promise(r => setTimeout(r, 500)); // rate limit
  }

  // Save updated watchlist
  const brandsData = loadBrands();
  brandsData.watchlist = watchlist;
  saveBrands(brandsData);

  // Sort by score
  results.sort((a, b) => b.score - a.score);
  const urgent  = results.filter(r => r.score >= 7);
  const topThree = results.slice(0, 3);

  console.log(`\n✅ Scoring complete. Urgent: ${urgent.length}, Top opportunity: ${results[0]?.brand.name}`);

  // ── Send urgent alerts ─────────────────────────────────────────────────────
  for (const r of urgent) {
    if (r.brand.lastAlertedDate === today) continue; // don't double-alert
    const msg = [
      `🎯 *URGENT: ${r.brand.name}* — ${r.score}/10`,
      ``,
      r.reasons.map(x => `• ${x}`).join('\n'),
      ``,
      `Draft pitch ready. Reply \`pitch ${r.brand.name}\` to generate it.`,
    ].join('\n');
    await sendTg(msg);
    r.brand.lastAlertedDate = today;
  }
  saveBrands({ watchlist });

  // ── Morning digest ─────────────────────────────────────────────────────────
  if (!topThree.length) {
    await sendTg('☀️ Good morning! No high-scoring opportunities today. Check back tomorrow.');
    return;
  }

  const digestLines = [
    `☀️ *Good morning! ${topThree.length} opportunities today*`,
    ``,
  ];

  topThree.forEach((r, i) => {
    const adNote = r.adData?.active
      ? `${r.adData.count} active UAE ads${r.adData.recentCount ? ` (${r.adData.recentCount} new this week)` : ''}`
      : 'No active ads detected';
    digestLines.push(
      `*${i + 1}. ${r.brand.name}* — ${r.score}/10`,
      `   ${r.reasons.slice(0, 2).join(' · ')}`,
      `   ${adNote}`,
      ``,
    );
  });

  digestLines.push(`Reply *1*, *2*, or *3* to generate the pitch for that brand.`);

  await sendTg(digestLines.join('\n'));
  console.log('\n📱 Digest sent to Telegram');
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });

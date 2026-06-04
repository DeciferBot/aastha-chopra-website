/**
 * Pitch Writer
 * Generates a personalised brand pitch using Aastha's profile + brand research.
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const env = {};
try {
  readFileSync(resolve(ROOT, '.env.local'), 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=["']?(.+?)["']?\s*$/);
    if (m) env[m[1].trim()] = m[2].trim();
  });
} catch {}

const ANTHROPIC_KEY = env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY;

function loadProfile() {
  return JSON.parse(readFileSync(resolve(__dirname, 'profile.json'), 'utf8'));
}

function loadBrandData(brandName) {
  try {
    const brands = JSON.parse(readFileSync(resolve(__dirname, 'brands.json'), 'utf8'));
    return brands.watchlist.find(b => b.name.toLowerCase() === brandName.toLowerCase()) || null;
  } catch { return null; }
}

async function researchBrand(brandName) {
  // Fetch brand's public Instagram bio and website for context
  // This is a simplified version — in production, use web scraping or Apify
  return {
    name: brandName,
    notes: 'No research data available — add manually or run research agent.',
  };
}

export async function generatePitch(brandName, brandContext = null) {
  const profile = loadProfile();
  const brandData = loadBrandData(brandName) || {};
  const research = brandContext || await researchBrand(brandName);

  const adSignal = brandData.lastAdData?.active
    ? `They are currently running ${brandData.lastAdData.count} active ads in the UAE${brandData.lastAdData.recentCount ? `, with ${brandData.lastAdData.recentCount} launched in the last 14 days` : ''}.`
    : '';

  if (!ANTHROPIC_KEY) {
    // Fallback: template-based pitch without AI
    return buildTemplatePitch(profile, brandName, adSignal);
  }

  const systemPrompt = `You write outreach emails from Aastha Chopra, a Dubai-based lifestyle creator, to brand managers.

VOICE: Confident, warm, direct. Reads like a real person wrote it — not a template, not a tool.

STRUCTURE — three parts, no headers, no bullet points:
1. HOOK: One sentence that shows you actually know this brand and why you're reaching out to them specifically. Reference something real — a campaign, a market move, a product direction. This is why a brand manager keeps reading.
2. BODY: Who Aastha is and why she's relevant to this brand. Lead with her Dubai reach and UAE audience. Her value is performance and quality of audience — not follower count alone.
3. ACTION: A soft collaborative close. Not "let's do a deal." More like opening a door — invite a conversation, make it easy to say yes.

HARD RULES — violating any of these means rewrite:
- Zero em dashes. Not one. Replace with a full stop or comma.
- Zero "not just X" constructions. This pattern is banned entirely. Write what something IS, never what it is NOT.
- Every sentence must be a positive statement. If you find yourself writing a negative, delete the sentence and restate it positively.
- Zero double negatives of any form.
- Zero "if X then Y" logic structures.
- No words: synergy, authentic, leverage, elevate, resonate, curated, align, journey, space, narrative
- No lists or bullet points inside the email body
- Under 130 words total
- Sign off as Aastha only — no title, no company name
- Read it back before outputting. If any hard rule is broken, fix it first.
- Aastha's voice is warm and forward-looking, never defensive. She says things like "it's always a pleasure working with brands you actually use" — genuine enthusiasm, positive framing. Never "I only work with..." which sounds like a policy. She speaks like someone who loves what she does, not someone protecting herself.`;

  const userPrompt = `Write a pitch email from Aastha Chopra to a brand manager at ${brandName}.

About Aastha:
- Dubai-based lifestyle creator, ${profile.instagram.followers.toLocaleString()} Instagram followers
- ${profile.instagram.monthlyUaeReach.toLocaleString()} people reached monthly across Dubai, Abu Dhabi and Sharjah
- Audience is 18-34 year olds, strong South Asian diaspora in UAE
- Known for quality content — lifestyle, fashion, beauty, fitness
- WhatsApp: ${profile.whatsapp}
- Media pack: ${profile.mediaPackUrl}

Brand context: ${adSignal || `${brandName} is active in the UAE lifestyle market.`}
${research.notes && research.notes !== 'No research data available — add manually or run research agent.' ? `Additional notes: ${research.notes}` : ''}

Write the email now. Follow the three-part structure: hook (why this brand specifically) → body (Aastha's UAE reach and audience quality) → action (open a door, not close a deal).
No lists. No em dashes. Human voice throughout.`;

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

  const emailBody = data.content[0].text;

  return {
    brand: brandName,
    email: emailBody,
    email_to: brandData.contactEmail || null,
    subject: `${brandName} × Aastha Chopra`,
    generatedAt: new Date().toISOString(),
  };
}

function buildTemplatePitch(profile, brandName, adSignal) {
  const email = `Hi,

${adSignal ? `Noticed ${brandName} is active in the UAE market right now — great timing to connect.` : `I've been following ${brandName} and think there's a natural fit here.`}

I'm Aastha Chopra — Dubai-based lifestyle creator with ${profile.instagram.followers.toLocaleString()} followers and ${profile.instagram.monthlyUaeReach.toLocaleString()} monthly reach across Dubai, Abu Dhabi and Sharjah. My core audience is ${profile.instagram.topAgeReached} year olds.

${profile.pitchStats.engagementHook}

Media pack: ${profile.mediaPackUrl}
WhatsApp: ${profile.whatsapp || '[add WhatsApp number to profile.json]'}

Aastha`;

  return {
    brand: brandName,
    email,
    email_to: null,
    subject: `${brandName} × Aastha Chopra`,
    generatedAt: new Date().toISOString(),
  };
}

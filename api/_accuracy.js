/**
 * Shared accuracy engine — the single implementation both outreach channels
 * (email pitches and Instagram DM digests) run their text through before
 * anything is stored or delivered. Two independent layers:
 *
 *   1. mechanicalProblems() — hard rules enforced in code that no wording can
 *      slip past: fabricated sightings, claimed relationships, banned filler
 *      words, stray dashes, and numbers that don't appear in the supplied
 *      fact sheet.
 *   2. verifyClaims() — an independent model call that reads the finished text
 *      against the ONLY facts we supplied and fails any specific claim that
 *      isn't supported.
 *
 * Callers use checkText() and fail CLOSED: text that doesn't pass is never
 * delivered — regenerate with the feedback, or skip the brand.
 *
 * Underscore-prefixed so Vercel does NOT expose it as a route.
 */

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const BANNED_WORDS = /\b(authentic|elevate|resonate|curated|align|journey|synergy|space|collab|leverage|narrative)\b/i;
const FAKE_EXPERIENCE = /\b(your feed|last week|yesterday|spotted|i saw|i visited|i tried|i wore|stopped my scroll|my routine|my rotation|i use it|i('ve| have) been (using|loving|wearing|reaching))\b/i;
const FAKE_RELATIONSHIP = /\bworked with\b/i;
const DASHES = /[—–]/;

// AI-tell phrases (Amit, 2026-08-31: "write like a natural marketer"). These
// showed up in nearly every generated pitch and DM, which is exactly why a
// brand manager's eye slides off them. Enforced here so no wording request has
// to be trusted.
const AI_TELLS = [
  [/bring(ing|s)?[^.!?]{0,40}to life/i, '"bring to life" filler'],
  [/\b(would you be open to|i would love to|i'd love to)\b/i, 'stock ask ("would you be open" / "I would love to")'],
  [/\bgenuinely\b/i, 'filler word "genuinely"'],
  [/\bhonestly\b/i, 'filler word "honestly"'],
  [/\bnot just\b/i, '"not just X" construction'],
  [/rent[- ]free/i, 'meme phrase "rent-free"'],
  [/\b(obsessed|iconic|chef'?s kiss|say less)\b/i, 'social-media filler word'],
];

/**
 * Numbers discipline: every digit-run in the text must literally appear in the
 * fact sheet the writer was given. No fact sheet = no numbers at all.
 */
function unsupportedNumbers(text, factSheet = '') {
  const nums = String(text).match(/\d[\d,.]*/g) || [];
  return nums.filter((n) => !factSheet.includes(n));
}

/** @returns {string[]} human-readable reasons; empty = clean */
export function mechanicalProblems(text, { factSheet = '' } = {}) {
  const problems = [];
  if (DASHES.test(text)) problems.push('contains a dash');
  if (FAKE_RELATIONSHIP.test(text)) problems.push('claims a past working relationship ("worked with")');
  if (FAKE_EXPERIENCE.test(text)) problems.push('claims a specific sighting or personal experience');
  const banned = String(text).match(BANNED_WORDS);
  if (banned) problems.push(`banned word "${banned[0]}"`);
  for (const [re, why] of AI_TELLS) {
    if (re.test(text)) problems.push(why);
  }
  const nums = unsupportedNumbers(text, factSheet);
  if (nums.length) problems.push(`cites number(s) not in the fact sheet: ${nums.join(', ')}`);
  return problems;
}

/**
 * The voice rules as prose, for embedding in writer prompts, so the writers
 * and the checker always describe the same rules from one place.
 */
export const VOICE_RULES = `Write like a sharp, natural marketer typing to a person:
- Short sentences. Concrete nouns. One clear ask, phrased plainly (e.g. "Who looks after creator partnerships for you in the UAE?").
- Vary your openings; no two sentences start the same way.
- NEVER use: "bring to life" in any form, "would you be open to", "I would love to", "genuinely", "honestly", "not just", "rent-free", "obsessed", "iconic", em dashes, or the words authentic/elevate/resonate/curated/align/journey/synergy.
- No compliment-sandwich openers. Open with something concrete and specific, not admiration filler.
- Never claim to use, own, or have a routine with the brand's products. She has not, unless the supplied facts say so.`;

/**
 * Independent fact-check. `facts` is the complete, plain-text list of what is
 * known to be true (brand description, allowed work references, allowed stats).
 * @returns {Promise<{ok:boolean, problems:string[]}>}
 */
export async function verifyClaims(facts, text) {
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
      system: `You are a strict fact-checker for outreach messages. You are given the ONLY facts known to be true, and a text. List every specific factual claim the text makes: named products, collections, campaigns, drops, stores, events, awards, timings, statistics, any claim of personal experience or product use (saw, tried, visited, wore, uses, owns, "in my routine", "been using"), and any implied past relationship. A claim is UNSUPPORTED unless it appears in the supplied facts. The writer has NEVER used the brand's products unless the facts say so. Pure opinions about style, category, or city life are not claims. Reply ONLY with JSON: {"ok": true} if every claim is supported, else {"ok": false, "problems": ["..."]}.`,
      messages: [{ role: 'user', content: `THE ONLY KNOWN FACTS:\n${facts}\n\nTEXT TO CHECK:\n${text}` }],
    }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  const m = data.content?.[0]?.text?.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, problems: ['checker gave no verdict'] };
  try {
    const v = JSON.parse(m[0]);
    return { ok: v.ok === true, problems: Array.isArray(v.problems) ? v.problems : [] };
  } catch {
    return { ok: false, problems: ['checker gave no verdict'] };
  }
}

/**
 * Run both layers over a finished text.
 * @returns {Promise<{ok:boolean, problems:string[]}>}
 */
export async function checkText({ text, facts, factSheet = '' }) {
  const mech = mechanicalProblems(text, { factSheet });
  if (mech.length) return { ok: false, problems: mech };
  return verifyClaims(facts, text);
}

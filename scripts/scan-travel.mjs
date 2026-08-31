/**
 * Travel scanner → data/travel-candidates.json
 * -----------------------------------------------------------------------------
 * Reads every Instagram post and guesses which ones were made on a real trip.
 * It is a GUESS. Nothing here goes on the map until Aastha ticks it off in the
 * ratify page, because captions lie: she posts about places she has not been to
 * (a dream trip, a brand, a throwback, a friend's photo).
 *
 * How it guesses, in plain terms:
 *   1. Looks for a place name in the caption or the hashtags.
 *   2. Groups posts about the same place that were made within 21 days of each
 *      other. That group is one candidate trip.
 *   3. Scores confidence. A trip with several posts over several days is almost
 *      certainly real. A single post mentioning Japan once is probably not.
 *   4. Flags the words that usually mean she was NOT there: "can't wait",
 *      "bucket list", "next stop", "throwback", "dreaming of".
 *
 * Output: data/travel-candidates.json — the ratification worklist, newest first.
 *
 * Usage:
 *   SUPABASE_SERVICE_KEY=... node scripts/scan-travel.mjs
 *   (SINCE defaults to 5 years back; TRIP_GAP_DAYS defaults to 21)
 */

import { writeFileSync, readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local if present (does not override real env)
try {
  readFileSync(resolve(__dirname, '../.env.local'), 'utf8').split('\n').forEach(line => {
    const m = line.match(/^([^#=]+)=["']?(.+?)["']?\s*$/);
    if (m && !process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim();
  });
} catch { /* no .env.local, rely on real env */ }

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://uqzvaytvynrglijvwjsz.supabase.co';
// Reading posts only needs the public key. The service key works too if set.
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
const SINCE = process.env.SINCE || '2021-01-01';
const TRIP_GAP_DAYS = Number(process.env.TRIP_GAP_DAYS || 21);

if (!SERVICE_KEY) {
  console.error('Missing SUPABASE_ANON_KEY (or SUPABASE_SERVICE_KEY). Set one and re-run.');
  process.exit(1);
}

/**
 * The gazetteer. Each entry is one place on the finished map.
 *   country : the label on the dot
 *   lat/lon : where the dot sits
 *   match   : words in a caption that point at this place
 *   home    : true for the UAE, which is where she lives, not a trip
 * Cities are listed under their country so a Paris post and a France post land
 * on the same dot instead of two.
 */
const PLACES = [
  { country: 'United Arab Emirates', home: true, lat: 25.20, lon: 55.27, match: ['dubai', 'uae', 'abu dhabi', 'sharjah', 'ras al khaimah', 'mydubai', 'emirates', 'jumeirah beach', 'palm jumeirah', 'downtown dubai', 'dubai marina', 'al ain', 'fujairah', 'hatta'] },
  { country: 'India', lat: 28.61, lon: 77.21, match: ['india', 'delhi', 'mumbai', 'bombay', 'jaipur', 'udaipur', 'goa', 'kerala', 'bangalore', 'bengaluru', 'chennai', 'kolkata', 'hyderabad', 'pune', 'agra', 'rajasthan', 'punjab', 'chandigarh', 'shimla', 'manali', 'rishikesh', 'varanasi', 'amritsar', 'lucknow', 'ahmedabad', 'jodhpur', 'jaisalmer', 'kashmir', 'srinagar', 'ladakh', 'darjeeling', 'ooty', 'coorg', 'mysore', 'pushkar'] },
  { country: 'United Kingdom', lat: 51.51, lon: -0.13, match: ['london', 'england', 'scotland', 'wales', 'edinburgh', 'cotswold', 'cotswolds', 'manchester', 'liverpool', 'oxford', 'cambridge', 'bath', 'brighton', 'glasgow', 'bicester', 'harrods', 'notting hill', 'mayfair', 'soho london', 'united kingdom', 'britain', 'lake district', 'windsor'] },
  { country: 'Finland', lat: 60.17, lon: 24.94, match: ['finland', 'helsinki', 'lapland', 'rovaniemi', 'levi finland', 'northern lights finland', 'saariselka', 'inari'] },
  { country: 'France', lat: 48.86, lon: 2.35, match: ['france', 'paris', 'nice france', 'cannes', 'saint tropez', 'st tropez', 'provence', 'bordeaux', 'lyon', 'marseille', 'eiffel', 'louvre', 'chamonix', 'french riviera', 'cote dazur'] },
  { country: 'Italy', lat: 41.90, lon: 12.50, match: ['italy', 'rome', 'roma', 'milan', 'milano', 'venice', 'venezia', 'florence', 'firenze', 'amalfi', 'positano', 'capri', 'lake como', 'tuscany', 'sardinia', 'sicily', 'naples', 'portofino', 'italia'] },
  { country: 'Spain', lat: 40.42, lon: -3.70, match: ['spain', 'ibiza', 'barcelona', 'madrid', 'marbella', 'seville', 'sevilla', 'valencia', 'mallorca', 'majorca', 'menorca', 'granada', 'malaga', 'espana'] },
  { country: 'Thailand', lat: 13.76, lon: 100.50, match: ['thailand', 'bangkok', 'phuket', 'krabi', 'koh samui', 'chiang mai', 'pattaya', 'phi phi', 'koh phangan'] },
  { country: 'Vietnam', lat: 21.03, lon: 105.85, match: ['vietnam', 'hanoi', 'ha long', 'halong', 'saigon', 'ho chi minh', 'da nang', 'hoi an', 'phu quoc'] },
  { country: 'Switzerland', lat: 46.95, lon: 7.45, match: ['switzerland', 'swiss', 'zurich', 'geneva', 'lucerne', 'interlaken', 'zermatt', 'jungfrau', 'st moritz', 'montreux'] },
  { country: 'Maldives', lat: 3.20, lon: 73.22, match: ['maldives', 'maldivian', 'male maldives'] },
  { country: 'Singapore', lat: 1.35, lon: 103.82, match: ['singapore', 'marina bay sands', 'sentosa'] },
  { country: 'Japan', lat: 35.68, lon: 139.69, match: ['japan', 'tokyo', 'kyoto', 'osaka', 'hokkaido', 'okinawa', 'mount fuji'] },
  { country: 'Sri Lanka', lat: 6.93, lon: 79.86, match: ['sri lanka', 'colombo', 'galle', 'kandy', 'bentota'] },
  { country: 'Saudi Arabia', lat: 24.71, lon: 46.68, match: ['saudi', 'riyadh', 'alula', 'al ula', 'jeddah', 'diriyah', 'red sea saudi'] },
  { country: 'Qatar', lat: 25.29, lon: 51.53, match: ['qatar', 'doha', 'lusail'] },
  { country: 'Oman', lat: 23.59, lon: 58.41, match: ['oman', 'muscat', 'salalah', 'musandam'] },
  { country: 'Bahrain', lat: 26.23, lon: 50.59, match: ['bahrain', 'manama'] },
  { country: 'Turkey', lat: 41.01, lon: 28.98, match: ['turkey', 'turkiye', 'istanbul', 'cappadocia', 'bodrum', 'antalya', 'izmir'] },
  { country: 'Greece', lat: 37.98, lon: 23.73, match: ['greece', 'santorini', 'mykonos', 'athens', 'crete', 'rhodes', 'corfu'] },
  { country: 'Indonesia', lat: -8.41, lon: 115.19, match: ['bali', 'indonesia', 'ubud', 'seminyak', 'jakarta', 'canggu', 'nusa penida'] },
  { country: 'United States', lat: 40.71, lon: -74.01, match: ['new york', 'nyc', 'los angeles', 'california', 'miami', 'las vegas', 'san francisco', 'chicago', 'hawaii', 'usa', 'united states', 'texas', 'boston', 'seattle', 'orlando', 'aspen'] },
  { country: 'Egypt', lat: 30.04, lon: 31.24, match: ['egypt', 'cairo', 'giza', 'luxor', 'sharm el sheikh', 'hurghada', 'pyramids'] },
  { country: 'Morocco', lat: 31.63, lon: -7.99, match: ['morocco', 'marrakech', 'marrakesh', 'casablanca', 'fez', 'chefchaouen'] },
  { country: 'Portugal', lat: 38.72, lon: -9.14, match: ['portugal', 'lisbon', 'porto', 'algarve', 'madeira'] },
  { country: 'Netherlands', lat: 52.37, lon: 4.90, match: ['netherlands', 'amsterdam', 'holland', 'rotterdam'] },
  { country: 'Germany', lat: 52.52, lon: 13.40, match: ['germany', 'berlin', 'munich', 'frankfurt', 'hamburg', 'cologne'] },
  { country: 'Austria', lat: 48.21, lon: 16.37, match: ['austria', 'vienna', 'salzburg', 'innsbruck'] },
  { country: 'Czechia', lat: 50.08, lon: 14.44, match: ['prague', 'czech'] },
  { country: 'Hungary', lat: 47.50, lon: 19.04, match: ['budapest', 'hungary'] },
  { country: 'Georgia', lat: 41.72, lon: 44.78, match: ['tbilisi', 'georgia country', 'batumi', 'kazbegi'] },
  { country: 'Armenia', lat: 40.18, lon: 44.51, match: ['armenia', 'yerevan'] },
  { country: 'Azerbaijan', lat: 40.41, lon: 49.87, match: ['azerbaijan', 'baku'] },
  { country: 'Malaysia', lat: 3.14, lon: 101.69, match: ['malaysia', 'kuala lumpur', 'langkawi', 'penang'] },
  { country: 'Philippines', lat: 14.60, lon: 120.98, match: ['philippines', 'manila', 'boracay', 'palawan', 'cebu'] },
  { country: 'Seychelles', lat: -4.68, lon: 55.49, match: ['seychelles', 'mahe seychelles', 'praslin'] },
  { country: 'Mauritius', lat: -20.35, lon: 57.55, match: ['mauritius', 'port louis'] },
  { country: 'South Africa', lat: -33.92, lon: 18.42, match: ['south africa', 'cape town', 'johannesburg', 'kruger', 'safari south africa'] },
  { country: 'Kenya', lat: -1.29, lon: 36.82, match: ['kenya', 'nairobi', 'masai mara', 'maasai mara'] },
  { country: 'Australia', lat: -33.87, lon: 151.21, match: ['australia', 'sydney', 'melbourne', 'gold coast', 'brisbane', 'perth'] },
  { country: 'Canada', lat: 43.65, lon: -79.38, match: ['canada', 'toronto', 'vancouver', 'banff', 'montreal'] },
  { country: 'Jordan', lat: 31.95, lon: 35.93, match: ['jordan', 'amman', 'petra', 'wadi rum', 'dead sea jordan'] },
  { country: 'Lebanon', lat: 33.89, lon: 35.50, match: ['lebanon', 'beirut'] },
  { country: 'Nepal', lat: 27.72, lon: 85.32, match: ['nepal', 'kathmandu', 'pokhara', 'everest'] },
  { country: 'Pakistan', lat: 33.69, lon: 73.05, match: ['pakistan', 'lahore', 'karachi', 'islamabad'] },
  { country: 'China', lat: 22.32, lon: 114.17, match: ['hong kong', 'china', 'shanghai', 'beijing', 'macau'] },
  { country: 'South Korea', lat: 37.57, lon: 126.98, match: ['south korea', 'seoul', 'jeju'] },
  { country: 'Belgium', lat: 50.85, lon: 4.35, match: ['belgium', 'brussels', 'bruges', 'antwerp'] },
  { country: 'Iceland', lat: 64.15, lon: -21.94, match: ['iceland', 'reykjavik'] },
  { country: 'Norway', lat: 59.91, lon: 10.75, match: ['norway', 'oslo', 'tromso', 'bergen'] },
  { country: 'Sweden', lat: 59.33, lon: 18.07, match: ['sweden', 'stockholm'] },
  { country: 'Denmark', lat: 55.68, lon: 12.57, match: ['denmark', 'copenhagen'] },
  { country: 'Croatia', lat: 45.81, lon: 15.98, match: ['croatia', 'dubrovnik', 'split croatia', 'hvar'] },
  { country: 'Monaco', lat: 43.74, lon: 7.42, match: ['monaco', 'monte carlo'] },
];

/** Words that usually mean she was NOT there when she posted. */
const NOT_THERE = [
  'cant wait', "can't wait", 'cannot wait', 'bucket list', 'next stop', 'next up',
  'dreaming of', 'dream destination', 'one day', 'someday', 'wish i was',
  'wish i were', 'take me back to', 'manifesting', 'on my list', 'wishlist',
  'wish list', 'planning a trip', 'planning our trip', 'coming soon to',
  'see you soon', 'counting down', 'booked', 'who wants to go', 'want to go',
  'would love to visit', 'hoping to visit', 'giveaway', 'win a trip',
];

/** Words that mean the post is about an old trip, so the date is wrong. */
const OLD_TRIP = ['throwback', 'tbt', 'flashback', 'take me back', 'last year in', 'a year ago', 'memories from'];

/** Words that mean she really was on a trip. These rescue one-post trips. */
const WAS_THERE = [
  'holiday', 'vacation', 'vacay', 'our trip', 'my trip', 'this trip', 'landed in',
  'just landed', 'arrived in', 'we flew', 'flying to', 'flew to', 'exploring',
  'wandering', 'checked into', 'checked in at', 'staying at', 'our stay',
  'day one', 'day 1', 'day 2', 'day 3', 'first taste of', 'family holiday',
  'road trip', 'we went to', 'spent the week', 'spent a week', 'week in',
  'days in', 'nights in', 'travel diary', 'travel diaries', 'currently in',
  'straight from', 'stranded',
];

/**
 * Words that mean the place name belongs to a PRODUCT, not a trip.
 * This is the big one. Perfume and fashion houses are named after cities, so
 * "Goldfield & Banks Australia" and "Teatro Firenze" look exactly like travel
 * until you notice the caption is a product launch.
 */
const BRAND_TALK = [
  'perfume', 'fragrance', 'scent', 'eau de', 'parfum', 'notes of', 'bottle',
  'collection', 'capsule', 'launch', 'launches', 'press day', 'debut', 'campaign',
  'available at', 'shop the', 'use code', 'discount', 'in stores', 'now open',
  'gifted', 'new drop', 'restock', 'my glam', 'lip liner', 'mascara', 'bronzer',
  'highlighter', 'skincare', 'serum', 'moisturiser', 'moisturizer',
];

/** She lives here. A caption that talks about Dubai is usually a night at home. */
const AT_HOME = ['dubai', 'uae', 'abu dhabi', 'mydubai', 'sharjah', 'in town'];

/** Strip @handles first, so "@goldfield_and_banks_australia" is not "australia". */
const stripHandles = (s) => (s || '').replace(/@[A-Za-z0-9._]+/g, ' ');

const norm = (s) => (s || '')
  .toLowerCase()
  .replace(/[#]/g, ' ')           // hashtags become plain words, handles are already gone
  .replace(/[^a-z0-9\s]/g, ' ')   // strip punctuation and emoji
  .replace(/\s+/g, ' ');

/** Find every place named in one caption. Longest match wins per place. */
function placesIn(text) {
  const t = ` ${norm(stripHandles(text))} `;
  const found = [];
  for (const p of PLACES) {
    let hit = null;
    for (const m of p.match) {
      if (t.includes(` ${m} `)) { if (!hit || m.length > hit.length) hit = m; }
    }
    if (hit) found.push({ place: p, term: hit });
  }
  return found;
}

function flagsIn(text) {
  const t = norm(stripHandles(text));
  const has = list => list.filter(w => t.includes(norm(w)));
  return {
    notThere: has(NOT_THERE),
    oldTrip: has(OLD_TRIP),
    wasThere: has(WAS_THERE),
    brandTalk: has(BRAND_TALK),
    atHome: has(AT_HOME),
  };
}

async function fetchAllPosts() {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const url = `${SUPABASE_URL}/rest/v1/instagram_posts`
      + `?select=id,caption,permalink,timestamp,like_count,comments_count,views,storage_thumbnail_url,storage_image_url,original_thumbnail_url,media_type`
      + `&timestamp=gte.${SINCE}&order=timestamp.desc`;
    const res = await fetch(url, {
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Range: `${from}-${from + PAGE - 1}`,
      },
    });
    if (!res.ok) throw new Error(`Supabase said ${res.status}: ${await res.text()}`);
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

const posts = await fetchAllPosts();
console.log(`Read ${posts.length} posts since ${SINCE}.`);

// Step 1: every post that names a place away from home.
const mentions = [];
for (const post of posts) {
  for (const { place, term } of placesIn(post.caption)) {
    if (place.home) continue;
    const f = flagsIn(post.caption);
    mentions.push({
      postId: post.id,
      country: place.country,
      lat: place.lat,
      lon: place.lon,
      matchedOn: term,
      date: post.timestamp.slice(0, 10),
      permalink: post.permalink,
      thumbnail: post.storage_thumbnail_url || post.storage_image_url || post.original_thumbnail_url || null,
      mediaType: post.media_type,
      views: post.views || null,
      likes: post.like_count || 0,
      comments: post.comments_count || 0,
      caption: (post.caption || '').slice(0, 400),
      notThereWords: f.notThere,
      oldTripWords: f.oldTrip,
      wasThereWords: f.wasThere,
      brandWords: f.brandTalk,
      atHomeWords: f.atHome,
    });
  }
}

// Step 2: group posts about the same country into trips, splitting on a long gap.
const byCountry = {};
for (const m of mentions) (byCountry[m.country] ||= []).push(m);

const trips = [];
for (const [country, list] of Object.entries(byCountry)) {
  list.sort((a, b) => a.date.localeCompare(b.date));
  let current = null;
  for (const m of list) {
    const gapDays = current
      ? (new Date(m.date) - new Date(current.lastDate)) / 86400000
      : Infinity;
    if (!current || gapDays > TRIP_GAP_DAYS) {
      current = { country, lat: m.lat, lon: m.lon, firstDate: m.date, lastDate: m.date, posts: [] };
      trips.push(current);
    }
    current.posts.push(m);
    current.lastDate = m.date;
  }
}

// Step 3: score how likely each trip is real, so the easy yeses are obvious and
// the brand-name noise sinks. Points for evidence she was there, points off for
// the things that fool a word search.
for (const t of trips) {
  const spanDays = Math.round((new Date(t.lastDate) - new Date(t.firstDate)) / 86400000);
  const all = w => [...new Set(t.posts.flatMap(p => p[w]))];
  const notThere = all('notThereWords');
  const oldTrip = all('oldTripWords');
  const wasThere = all('wasThereWords');
  const brand = all('brandWords');
  const atHome = all('atHomeWords');

  // Posts where the ONLY thing tying her to the place is product talk.
  const brandOnly = t.posts.filter(p => p.brandWords.length && !p.wasThereWords.length).length;

  let score = 0;
  const forIt = [], against = [];

  if (t.postCount >= 4) { score += 3; forIt.push(`${t.postCount} posts mention it`); }
  else if (t.postCount >= 2) { score += 2; forIt.push(`${t.postCount} posts mention it`); }
  if (spanDays >= 2) { score += 2; forIt.push(`posts span ${spanDays} days`); }
  if (wasThere.length) { score += 3; forIt.push(`says "${wasThere.join('", "')}"`); }

  if (brandOnly === t.postCount && brand.length) {
    score -= 4;
    against.push(`reads like a product post, not a trip: "${brand.slice(0, 3).join('", "')}"`);
  }
  if (atHome.length && !wasThere.length) {
    score -= 3;
    against.push(`caption is about home: "${atHome.join('", "')}"`);
  }
  if (notThere.length) { score -= 4; against.push(`says "${notThere.join('", "')}"`); }
  if (oldTrip.length) { score -= 1; against.push(`says "${oldTrip.join('", "')}" so the date may be wrong`); }
  if (t.postCount === 1 && !wasThere.length) {
    score -= 1;
    against.push('only one post mentions this place');
  }

  const confidence = score >= 4 ? 'high' : score >= 1 ? 'medium' : 'low';

  Object.assign(t, {
    tripId: `${t.country.toLowerCase().replace(/[^a-z]+/g, '-')}-${t.firstDate}`,
    spanDays,
    postCount: t.posts.length,
    score,
    confidence,
    forIt,
    against,
    verdict: null,        // Aastha fills this in: "yes" or "no"
    ratifiedAt: null,
  });
}

trips.sort((a, b) => b.firstDate.localeCompare(a.firstDate));

const byConfidence = c => trips.filter(t => t.confidence === c).length;
const out = {
  generated_at: new Date().toISOString(),
  source: 'supabase:instagram_posts captions and hashtags',
  warning: 'EVERY TRIP HERE IS A GUESS. Nothing goes on the map until verdict is "yes".',
  since: SINCE,
  posts_scanned: posts.length,
  summary: {
    candidate_trips: trips.length,
    countries: new Set(trips.map(t => t.country)).size,
    high_confidence: byConfidence('high'),
    medium_confidence: byConfidence('medium'),
    low_confidence: byConfidence('low'),
  },
  trips,
};

const dest = resolve(__dirname, '../data/travel-candidates.json');
writeFileSync(dest, JSON.stringify(out, null, 2));

console.log(`\n${trips.length} candidate trips across ${out.summary.countries} countries.`);
console.log(`  ${byConfidence('high')} look solid, ${byConfidence('medium')} are worth a look, ${byConfidence('low')} are probably wrong.`);
console.log(`\nWritten to data/travel-candidates.json`);
for (const level of ['high', 'medium', 'low']) {
  const list = trips.filter(t => t.confidence === level);
  console.log(`\n=== ${level.toUpperCase()} (${list.length}) ===`);
  for (const t of list) {
    const when = t.spanDays > 0 ? `${t.firstDate} to ${t.lastDate}` : t.firstDate;
    console.log(`  ${t.country.padEnd(22)} ${when.padEnd(26)} ${String(t.postCount).padStart(2)} post(s)`);
    if (t.forIt.length) console.log(`      for: ${t.forIt.join('; ')}`);
    if (t.against.length) console.log(`      against: ${t.against.join('; ')}`);
  }
}

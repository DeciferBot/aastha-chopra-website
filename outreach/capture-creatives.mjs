/**
 * Capture real ad-creative thumbnails from the Meta Ad Library.
 *
 * For each discovered brand it loads the ad's public snapshot page, grabs the
 * actual creative (largest creative image, or a video poster, or — last resort —
 * an element screenshot), and writes images/ad-creatives/<page_id>.jpg. Those are
 * served statically by the site, so the dashboard just points <img> at them.
 *
 * Run locally:  node outreach/capture-creatives.mjs
 * Prints a JSON summary at the end (used to patch last_ad_data.creative_image).
 */
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'images', 'ad-creatives');
mkdirSync(OUT, { recursive: true });

const TARGETS = [
  { page_id: '122902834243073', name: 'Abra Jewellery',          url: 'https://www.facebook.com/ads/library/?id=1000778352355709' },
  { page_id: '321354837728383', name: 'Azhrance',                url: 'https://www.facebook.com/ads/library/?id=1489902106484297' },
  { page_id: '779603921910664', name: 'By Amal Abayas',          url: 'https://www.facebook.com/ads/library/?id=4215435752053353' },
  { page_id: '102813364775826', name: 'CAS Abaya',               url: 'https://www.facebook.com/ads/library/?id=1796630705044075' },
  { page_id: '1140070059195710', name: 'Casvera Wellness',       url: 'https://www.facebook.com/ads/library/?id=1545064857236788' },
  { page_id: '112478775281907', name: 'Dopamine Beauty Center',  url: 'https://www.facebook.com/ads/library/?id=1016470617597048' },
  { page_id: '240309482490945', name: 'Glow up by Dina',         url: 'https://www.facebook.com/ads/library/?id=1659455665109574' },
  { page_id: '100532606363256', name: 'HEM Fashion',             url: 'https://www.facebook.com/ads/library/?id=990963563913042' },
  { page_id: '256449990882590', name: 'Hues and Charms',         url: 'https://www.facebook.com/ads/library/?id=1331817492256364' },
  { page_id: '203152129548845', name: 'La Tuya - Home Spa',      url: 'https://www.facebook.com/ads/library/?id=1554256466039254' },
  { page_id: '175949198929366', name: 'LINK Concept Store',      url: 'https://www.facebook.com/ads/library/?id=1012630601145765' },
  { page_id: '125113577512735', name: 'Louzan Fashion',          url: 'https://www.facebook.com/ads/library/?id=1002805416041865' },
  { page_id: '1213682915155323', name: 'luna_wellness_ae',       url: 'https://www.facebook.com/ads/library/?id=981362531192970' },
  { page_id: '491480137388317', name: 'Maison Estrellas',        url: 'https://www.facebook.com/ads/library/?id=1721897062176217' },
  { page_id: '721551587713789', name: 'Moj Perfumes UAE',        url: 'https://www.facebook.com/ads/library/?id=987305100688557' },
  { page_id: '340119152514851', name: 'Ossloop',                 url: 'https://www.facebook.com/ads/library/?id=982193667839397' },
  { page_id: '110246951127569', name: 'Plethora UAE',            url: 'https://www.facebook.com/ads/library/?id=3554586771384450' },
  { page_id: '396074620246355', name: 'soulfumez',              url: 'https://www.facebook.com/ads/library/?id=1007882508451739' },
  { page_id: '101739545979808', name: 'The Abaya Lab',           url: 'https://www.facebook.com/ads/library/?id=1515847822796932' },
  { page_id: '697544783437219', name: 'Vera Wellness Collective',url: 'https://www.facebook.com/ads/library/?id=4494875650802124' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function download(url) {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 8000 ? buf : null;
  } catch { return null; }
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
const results = [];

for (const t of TARGETS) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1100, height: 1500, deviceScaleFactor: 2 });
  let method = null, saved = false;
  const dest = resolve(OUT, `${t.page_id}.jpg`);

  try {
    try { await page.goto(t.url, { waitUntil: 'networkidle2', timeout: 45000 }); } catch {}

    // Dismiss cookie/consent banner if present
    try {
      await page.evaluate(() => {
        const b = [...document.querySelectorAll('[role="button"],button')]
          .find((x) => /allow all|only allow essential|accept|decline optional/i.test(x.innerText || ''));
        if (b) b.click();
      });
      await sleep(2000);
    } catch {}
    try { await page.evaluate(() => window.scrollBy(0, 700)); await sleep(1500); } catch {}

    // Candidate creative URLs: large DOM images (not the avatar) + video posters.
    const candidates = await page.evaluate(() => {
      const imgs = [...document.images]
        .map((i) => ({ src: i.currentSrc || i.src, area: i.naturalWidth * i.naturalHeight, kind: 'img' }))
        .filter((i) => /fbcdn|scontent/.test(i.src) && i.area > 40000 && !/t39\.30808/.test(i.src));
      const posters = [...document.querySelectorAll('video')]
        .map((v) => ({ src: v.poster, area: (v.videoWidth || 500) * (v.videoHeight || 500), kind: 'poster' }))
        .filter((p) => p.src && /fbcdn|scontent/.test(p.src));
      return [...imgs, ...posters].sort((a, b) => b.area - a.area).slice(0, 4);
    });

    for (const c of candidates) {
      const buf = await download(c.src);
      if (buf) { writeFileSync(dest, buf); saved = true; method = c.kind === 'poster' ? 'video-poster' : 'network'; break; }
    }

    // Fallback: screenshot the largest media element on the page.
    if (!saved) {
      const handle = await page.evaluateHandle(() => {
        const els = [...document.querySelectorAll('img, video')]
          .map((e) => ({ e, a: e.getBoundingClientRect().width * e.getBoundingClientRect().height }))
          .filter((o) => o.a > 60000 && !/t39\.30808/.test(o.e.currentSrc || o.e.src || ''))
          .sort((x, y) => y.a - x.a);
        return els[0]?.e || null;
      });
      const el = handle.asElement();
      if (el) {
        try { await el.screenshot({ path: dest, type: 'jpeg', quality: 82 }); saved = true; method = 'screenshot'; } catch {}
      }
    }
  } catch (e) {
    // swallow — recorded as not saved
  }

  results.push({ name: t.name, page_id: t.page_id, saved, method });
  console.log(`${saved ? '✓' : '✗'} ${t.name.padEnd(26)} ${method || 'FAILED'}`);
  await page.close();
}

await browser.close();
const ok = results.filter((r) => r.saved);
console.log(`\nCaptured ${ok.length}/${results.length}`);
console.log('JSON_SUMMARY=' + JSON.stringify(results.filter((r) => r.saved).map((r) => r.page_id)));

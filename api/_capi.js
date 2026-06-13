// Meta Conversions API (CAPI) helper — server-side event forwarding.
// Underscore-prefixed so Vercel does NOT expose it as a route; imported by
// other /api functions. Sends deduplicated server events to the Meta pixel
// dataset, with PII SHA-256 hashed per Meta's requirements.
import crypto from 'crypto';

const GRAPH_VERSION = 'v21.0';
const PIXEL_ID = process.env.META_PIXEL_ID || '1558622859213180';
const ACCESS_TOKEN = process.env.META_CAPI_ACCESS_TOKEN;
const TEST_EVENT_CODE = process.env.META_CAPI_TEST_CODE; // optional, for Test events tab

// SHA-256 hash of a normalized string (lowercased, trimmed). Returns undefined
// for empty input so the field is omitted rather than sent as a hash of "".
function hash(value) {
  if (!value) return undefined;
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return undefined;
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

// Pull the _fbp / _fbc cookies (set by the browser pixel) from a request so
// server events can be matched to the same user/click.
function readFbCookies(req) {
  const cookie = req.headers?.cookie || '';
  const out = {};
  cookie.split(';').forEach((part) => {
    const [k, ...v] = part.trim().split('=');
    if (k === '_fbp') out.fbp = v.join('=');
    if (k === '_fbc') out.fbc = v.join('=');
  });
  return out;
}

/**
 * Send a single server-side event to the Meta Conversions API.
 * Never throws — logs and returns { ok:false } on failure so it can't break
 * the calling request flow.
 *
 * @param {object}  p
 * @param {string}  p.eventName        e.g. 'Subscribe', 'Lead'
 * @param {string}  p.eventId          shared with the browser pixel for dedup
 * @param {object}  p.req              the incoming request (for IP/UA/cookies)
 * @param {string} [p.eventSourceUrl]  page URL where the event happened
 * @param {string} [p.email]           raw email (hashed internally)
 * @param {string} [p.firstName]       raw first name (hashed internally)
 * @param {object} [p.customData]      Meta custom_data (value, currency, etc.)
 */
export async function sendCapiEvent(p) {
  if (!ACCESS_TOKEN) {
    console.warn('[capi] META_CAPI_ACCESS_TOKEN not set — skipping server event');
    return { ok: false, skipped: true };
  }

  const req = p.req || {};
  const fwd = req.headers?.['x-forwarded-for'];
  const clientIp = (Array.isArray(fwd) ? fwd[0] : fwd || '').split(',')[0].trim() || undefined;
  const userAgent = req.headers?.['user-agent'];
  const { fbp, fbc } = readFbCookies(req);

  const user_data = {
    em: hash(p.email) ? [hash(p.email)] : undefined,
    fn: hash(p.firstName) ? [hash(p.firstName)] : undefined,
    client_ip_address: clientIp,
    client_user_agent: userAgent,
    fbp,
    fbc,
  };
  // Strip undefined keys
  Object.keys(user_data).forEach((k) => user_data[k] === undefined && delete user_data[k]);

  const event = {
    event_name: p.eventName,
    event_time: Math.floor(Date.now() / 1000),
    event_id: p.eventId,
    action_source: 'website',
    event_source_url: p.eventSourceUrl,
    user_data,
  };
  if (p.customData) event.custom_data = p.customData;

  const payload = { data: [event] };
  if (TEST_EVENT_CODE) payload.test_event_code = TEST_EVENT_CODE;

  try {
    const url = `https://graph.facebook.com/${GRAPH_VERSION}/${PIXEL_ID}/events?access_token=${encodeURIComponent(ACCESS_TOKEN)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error('[capi] Meta rejected event:', res.status, body);
      return { ok: false, status: res.status, body };
    }
    return { ok: true, body };
  } catch (err) {
    console.error('[capi] send failed:', err);
    return { ok: false, error: String(err) };
  }
}

// Generic Conversions API forwarder for browser-originated conversions whose
// submission doesn't already pass through a Vercel function (e.g. the contact
// brief, which posts directly to Supabase). The browser fires the matching
// pixel event with the same eventId, so Meta deduplicates the pair.
import { sendCapiEvent } from './_capi.js';

// Only allow conversion events we actually use — never an open relay.
const ALLOWED = new Set(['Lead', 'Contact', 'Subscribe']);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { eventName, eventId, email, firstName, customData } = req.body || {};

  if (!ALLOWED.has(eventName)) {
    return res.status(400).json({ error: 'Unsupported event' });
  }
  if (!eventId) {
    return res.status(400).json({ error: 'eventId required' });
  }

  await sendCapiEvent({
    eventName,
    eventId,
    req,
    email,
    firstName,
    eventSourceUrl: req.headers?.referer,
    customData: customData && typeof customData === 'object' ? customData : undefined,
  });

  // Always 200 — tracking must not surface errors to the visitor.
  return res.status(200).json({ ok: true });
}

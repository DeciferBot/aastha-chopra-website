/**
 * Outreach pipeline tracker — the single place every outgoing pitch is logged so the
 * Telegram `status` command and any dashboard reflect reality instead of zeros.
 *
 * One row per pitch send, in `outreach_pipeline`:
 *   status='queued' → forwarded to Aastha's inbox, awaiting her manual forward
 *   status='sent'   → emailed straight to the brand (autosend), opens/clicks tracked
 *                     by the Resend webhook keyed on resend_email_id.
 *
 * recordPipeline NEVER throws — a tracking failure must not break the actual send.
 *
 * Underscore-prefixed so Vercel does NOT expose it as a route.
 */

const SUPABASE_URL = 'https://uqzvaytvynrglijvwjsz.supabase.co';
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

export async function recordPipeline({
  brandName, contactEmail = null, subject = null, body = null,
  status = 'queued', resendId = null, route = null,
}) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/outreach_pipeline`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify([{
        // brand_name and contact_email are NOT NULL in the schema; coalesce so a
        // pitch with no known brand email (common on the forward-to-Aastha path)
        // still records instead of silently failing the insert.
        brand_name: brandName || 'Unknown',
        contact_email: contactEmail || '',
        subject,
        pitch_body: body,
        status,                          // 'queued' | 'sent' | 'replied' | 'deal' | 'bounced'
        opens: 0,
        clicks: 0,
        resend_email_id: resendId,
        sent_at: new Date().toISOString(),
        notes: route ? `route:${route}` : null,
      }]),
    });
    if (!res.ok) {
      console.error('recordPipeline failed:', await res.text());
      return null;
    }
    const rows = await res.json().catch(() => []);
    return rows?.[0]?.id ?? null;
  } catch (e) {
    console.error('recordPipeline error:', e?.message || e);
    return null;
  }
}

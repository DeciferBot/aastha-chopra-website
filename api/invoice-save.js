export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { invoiceNumber, agencyName, billToText, campaign, poNumber, currency, total, lineItems, profile, agencyContactName, agencyContactEmail } = req.body || {};

  if (!Number.isFinite(invoiceNumber) || invoiceNumber <= 0 || !agencyName || !billToText) {
    return res.status(400).json({ error: 'A positive invoiceNumber, agencyName and billToText are required' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // Upsert the agency by a case/whitespace-insensitive key so "Acme Media"
    // and "ACME Media " update the same row instead of creating a duplicate.
    // Contact fields are only included when provided, so leaving them blank
    // on a repeat invoice never erases a contact already saved for this agency.
    const agencyPayload = {
      name: agencyName,
      name_key: agencyName.trim().toLowerCase(),
      bill_to_text: billToText,
      currency: currency || 'AED',
      last_used_at: new Date().toISOString(),
    };
    if (agencyContactName) agencyPayload.contact_name = agencyContactName;
    if (agencyContactEmail) agencyPayload.contact_email = agencyContactEmail;

    const agencyRes = await fetch(`${SUPABASE_URL}/rest/v1/invoice_agencies?on_conflict=name_key`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([agencyPayload]),
    });
    if (!agencyRes.ok) throw new Error(`agency upsert failed: ${await agencyRes.text()}`);
    const agencyRows = await agencyRes.json();
    const agencyId = agencyRows?.[0]?.id || null;

    // The invoice insert and the counter bump are independent of each other
    // once agencyId is known, so run them together instead of sequentially.
    // bump_invoice_counter is a single atomic UPDATE...RETURNING (see
    // migration invoice_counter_rpc_and_agency_key) — no read-then-write race.
    const [invoiceRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/invoices?on_conflict=invoice_number`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates' },
        body: JSON.stringify([{
          invoice_number: invoiceNumber,
          agency_id: agencyId,
          agency_name: agencyName,
          campaign: campaign || null,
          po_number: poNumber || null,
          currency: currency || 'AED',
          total: total || 0,
          line_items: lineItems || [],
        }]),
      }),
      fetch(`${SUPABASE_URL}/rest/v1/rpc/bump_invoice_counter`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ p_number: invoiceNumber }),
      }),
    ]);
    if (!invoiceRes.ok) throw new Error(`invoice insert failed: ${await invoiceRes.text()}`);

    // Keep her business/bank profile current so it's the same on any device next time.
    if (profile && typeof profile === 'object') {
      await fetch(`${SUPABASE_URL}/rest/v1/invoice_profile?id=eq.1`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({
          business_name: profile.businessName || null,
          license_number: profile.licenseNumber || null,
          email: profile.yourEmail || null,
          phone: profile.yourPhone || null,
          instagram_url: profile.instagramUrl || null,
          bank_name: profile.bankName || null,
          account_name: profile.accountName || null,
          account_number: profile.accountNumber || null,
          swift: profile.swift || null,
          iban: profile.iban || null,
          updated_at: new Date().toISOString(),
        }),
      });
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('invoice-save error:', e?.message || e);
    res.status(500).json({ error: 'Could not save invoice' });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { invoiceNumber, agencyName, billToText, campaign, poNumber, currency, total, lineItems } = req.body || {};

  if (!invoiceNumber || !agencyName || !billToText) {
    return res.status(400).json({ error: 'invoiceNumber, agencyName and billToText are required' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    'Content-Type': 'application/json',
  };

  try {
    // Upsert the agency by name so her saved bill-to details stay current.
    const agencyRes = await fetch(`${SUPABASE_URL}/rest/v1/invoice_agencies?on_conflict=name`, {
      method: 'POST',
      headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify([{
        name: agencyName,
        bill_to_text: billToText,
        currency: currency || 'AED',
        last_used_at: new Date().toISOString(),
      }]),
    });
    if (!agencyRes.ok) throw new Error(`agency upsert failed: ${await agencyRes.text()}`);
    const agencyRows = await agencyRes.json();
    const agencyId = agencyRows?.[0]?.id || null;

    const invoiceRes = await fetch(`${SUPABASE_URL}/rest/v1/invoices?on_conflict=invoice_number`, {
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
    });
    if (!invoiceRes.ok) throw new Error(`invoice insert failed: ${await invoiceRes.text()}`);

    // Only move the counter forward — never let a re-generated or manually-edited
    // lower number push it backwards.
    const counterRes = await fetch(`${SUPABASE_URL}/rest/v1/invoice_counter?select=last_number&id=eq.1`, { headers });
    const counterRows = await counterRes.json();
    const currentLast = counterRows?.[0]?.last_number ?? 0;
    if (invoiceNumber > currentLast) {
      await fetch(`${SUPABASE_URL}/rest/v1/invoice_counter?id=eq.1`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ last_number: invoiceNumber, updated_at: new Date().toISOString() }),
      });
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('invoice-save error:', e?.message || e);
    res.status(500).json({ error: 'Could not save invoice' });
  }
}

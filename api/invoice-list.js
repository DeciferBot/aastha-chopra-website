export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/invoices?select=invoice_number,agency_name,campaign,po_number,currency,total,line_items,created_at&order=invoice_number.desc&limit=10`,
      { headers }
    );
    if (!r.ok) throw new Error(`Supabase error: ${r.status}`);
    const rows = await r.json();

    res.status(200).json({
      invoices: (rows || []).map(row => ({
        invoiceNumber: row.invoice_number,
        agencyName: row.agency_name,
        campaign: row.campaign,
        poNumber: row.po_number,
        currency: row.currency,
        total: row.total,
        lineItems: row.line_items || [],
        createdAt: row.created_at,
      })),
    });
  } catch (e) {
    console.error('invoice-list error:', e?.message || e);
    res.status(500).json({ error: 'Could not load invoice history' });
  }
}

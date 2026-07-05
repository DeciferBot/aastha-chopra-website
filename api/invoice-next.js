export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };

  try {
    const [counterRes, agenciesRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/invoice_counter?select=last_number&id=eq.1`, { headers }),
      fetch(`${SUPABASE_URL}/rest/v1/invoice_agencies?select=name,bill_to_text,currency&order=last_used_at.desc.nullslast,name.asc`, { headers }),
    ]);

    if (!counterRes.ok || !agenciesRes.ok) {
      throw new Error(`Supabase error: ${counterRes.status}/${agenciesRes.status}`);
    }

    const counterRows = await counterRes.json();
    const agencies = await agenciesRes.json();
    const lastNumber = counterRows?.[0]?.last_number ?? 0;

    res.status(200).json({
      nextNumber: lastNumber + 1,
      agencies: (agencies || []).map(a => ({
        name: a.name,
        billToText: a.bill_to_text,
        currency: a.currency,
      })),
    });
  } catch (e) {
    console.error('invoice-next error:', e?.message || e);
    res.status(500).json({ error: 'Could not load invoice data' });
  }
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Subjects go through JSON, not raw SMTP headers, but strip control
// characters as cheap defense-in-depth against header injection.
function sanitizeSubject(s) {
  return String(s || '').replace(/[\r\n]+/g, ' ').trim();
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { agencyEmail, ccEmail, agencyName, campaign, invoiceNumber, pdfBase64, filename } = req.body || {};

  if (!agencyEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(agencyEmail)) {
    return res.status(400).json({ error: 'A valid agency/brand email is required' });
  }
  if (!pdfBase64 || !filename) {
    return res.status(400).json({ error: 'Missing invoice PDF' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const subjectBits = sanitizeSubject([invoiceNumber, campaign || agencyName].filter(Boolean).join(' — '));

  const cc = ccEmail && ccEmail.toLowerCase() !== agencyEmail.toLowerCase() ? [ccEmail] : undefined;

  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Aastha Chopra <hello@aasthachopra.com>',
        to: [agencyEmail],
        ...(cc ? { cc } : {}),
        subject: `Invoice ${subjectBits}`,
        html: `<p>Hi,</p><p>Please find attached invoice ${invoiceNumber ? '<strong>' + escapeHtml(invoiceNumber) + '</strong>' : ''}${campaign ? ' for <strong>' + escapeHtml(campaign) + '</strong>' : ''}.</p><p>Thank you,<br/>Aastha Chopra</p>`,
        attachments: [{ filename, content: pdfBase64 }],
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      throw new Error(`Resend error: ${r.status} ${errText}`);
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('invoice-email error:', e?.message || e);
    res.status(500).json({ error: 'Could not send the email' });
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { email } = req.body;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'Valid email required' });
  }

  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  const SEGMENT_ID = 'ba2d2ef4-a557-4b2d-89f5-87061bdfd0a9'; // Aastha Chopra — Newsletter

  try {
    // 1. Add contact to the Aastha Chopra newsletter segment
    const contactRes = await fetch('https://api.resend.com/contacts', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        unsubscribed: false,
        segment_ids: [SEGMENT_ID],
      }),
    });

    if (!contactRes.ok) {
      const err = await contactRes.json();
      // If contact already exists, still send welcome — don't fail
      if (!err.name?.includes('already_exists') && contactRes.status !== 409) {
        throw new Error(err.message || 'Failed to add contact');
      }
    }

    // 2. Send welcome email
    // Note: requires aasthachopra.com to be verified in Resend dashboard
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Aastha Chopra <hello@aasthachopra.com>',
        to: [email],
        subject: 'Welcome — you\'re on the list ✦',
        html: `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <style>
    body { margin: 0; padding: 0; background: #FAF8F5; font-family: Georgia, serif; }
    .wrap { max-width: 560px; margin: 0 auto; padding: 60px 40px; }
    .logo { font-size: 1.4rem; font-weight: 300; color: #1A1A1A; letter-spacing: 0.06em; margin-bottom: 48px; }
    .logo em { font-style: italic; color: #C9A84C; }
    .divider { width: 60px; height: 1px; background: #C9A84C; margin-bottom: 40px; }
    h1 { font-size: 2rem; font-weight: 300; color: #1A1A1A; line-height: 1.2; margin: 0 0 24px; }
    h1 em { font-style: italic; color: #C9A84C; }
    p { font-family: 'Helvetica Neue', sans-serif; font-size: 0.9rem; font-weight: 300; line-height: 1.8; color: #4A4A4A; margin: 0 0 20px; }
    .cta { display: inline-block; margin-top: 8px; font-family: 'Helvetica Neue', sans-serif; font-size: 0.65rem; font-weight: 400; letter-spacing: 0.3em; text-transform: uppercase; color: #1A1A1A; text-decoration: none; background: #C9A84C; padding: 14px 32px; }
    .footer { margin-top: 56px; padding-top: 32px; border-top: 1px solid rgba(26,26,26,0.1); font-family: 'Helvetica Neue', sans-serif; font-size: 0.7rem; color: #8A8580; line-height: 1.6; }
    .footer a { color: #C9A84C; text-decoration: none; }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="logo">Aastha <em>Chopra</em></div>
    <div class="divider"></div>
    <h1>Welcome to<br>the <em>edit</em></h1>
    <p>Thank you for subscribing. You'll receive monthly drops of my favourite finds — style notes, travel edits from Dubai and beyond, wellness rituals, and the occasional exclusive from the brands I love.</p>
    <p>Expect beauty with intention, not noise.</p>
    <a href="https://www.aasthachopra.com" class="cta">Visit the Site</a>
    <div class="footer">
      You're receiving this because you signed up at aasthachopra.com.<br>
      <a href="https://www.instagram.com/aastha_sochic/">@aastha_sochic</a> &nbsp;·&nbsp; Dubai, UAE<br><br>
      <a href="#">Unsubscribe</a>
    </div>
  </div>
</body>
</html>`,
        text: `Welcome to the edit — Aastha Chopra\n\nThank you for subscribing. You'll receive monthly drops of my favourite finds — style notes, travel edits from Dubai and beyond, wellness rituals, and the occasional exclusive from the brands I love.\n\nVisit the site: https://www.aasthachopra.com\n\n@aastha_sochic · Dubai, UAE`,
      }),
    });

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Subscribe error:', err);
    return res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
}

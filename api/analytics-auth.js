export default function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const { password } = req.body || {};

  if (password === 'Aastha123!') {
    res.setHeader('Set-Cookie', 'analytics_auth=1; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400');
    return res.status(200).json({ ok: true });
  }

  return res.status(401).json({ ok: false });
}

export default async function handler(req, res) {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) return res.status(500).json({ error: 'No token' });

  const fields = 'id,name,username,biography,followers_count,follows_count,media_count,profile_picture_url,website';
  const r = await fetch(`https://graph.instagram.com/me?fields=${fields}&access_token=${token}`);
  const data = await r.json();
  res.json(data);
}

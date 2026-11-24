const API_ROOT = 'https://api.clashofclans.com/v1';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=600');
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed.' });
  }

  const apiKey = process.env.COC_API_KEY;
  const clanTag = process.env.COC_CLAN_TAG;
  if (!apiKey || !clanTag) {
    return res.status(503).json({ error: 'Clash of Clans data is not configured yet.' });
  }

  const encodedTag = `%23${encodeURIComponent(clanTag.replace(/^#/, ''))}`;
  try {
    const upstream = await fetch(`${API_ROOT}/clans/${encodedTag}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(8000)
    });
    if (!upstream.ok) {
      return res.status(upstream.status === 404 ? 404 : 502).json({ error: 'Could not load clan details.' });
    }
    const clan = await upstream.json();
    return res.status(200).json({
      name: clan.name,
      tag: clan.tag,
      description: clan.description,
      clanLevel: clan.clanLevel,
      members: clan.members,
      clanPoints: clan.clanPoints,
      warWins: clan.warWins,
      location: clan.location?.name,
      badgeUrls: clan.badgeUrls
    });
  } catch {
    return res.status(502).json({ error: 'Could not reach the Clash of Clans API.' });
  }
};

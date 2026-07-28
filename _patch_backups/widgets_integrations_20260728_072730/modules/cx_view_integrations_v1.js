'use strict';

const crypto = require('crypto');

const CATALOG = [
  { id: 'weather', label: 'Météo', category: 'data', status: 'ACTIVE', playerRoute: 'widget-data?type=WEATHER' },
  { id: 'rss', label: 'Flux RSS', category: 'data', status: 'ACTIVE', playerRoute: 'widget-data?type=RSS' },
  { id: 'traffic', label: 'Trafic', category: 'mobility', status: 'PLANNED' },
  { id: 'calendar', label: 'Calendrier', category: 'productivity', status: 'PLANNED' },
  { id: 'social', label: 'Réseaux sociaux', category: 'social', status: 'PLANNED' },
  { id: 'qr-to-screen', label: 'QR to Screen', category: 'interaction', status: 'PLANNED' },
  { id: 'webhook', label: 'Webhooks', category: 'automation', status: 'PLANNED' },
  { id: 'custom-api', label: 'API personnalisée', category: 'data', status: 'PLANNED' }
];

function register({ app, q, auth, adminOnly }) {
  const tokenHash = token => crypto.createHash('sha256').update(String(token || '')).digest('hex');
  const bearer = req => {
    const value = String(req.headers.authorization || '');
    return value.startsWith('Bearer ') ? value.slice(7).trim() : '';
  };
  async function playerOnly(req, res, next) {
    try {
      const code = String(req.params.code || '').trim().toUpperCase();
      const found = await q('SELECT id,player_token_hash FROM cx_screens WHERE pairing_code=$1', [code]);
      const screen = found.rows[0];
      if (!screen) return res.status(404).json({ error: 'Code introuvable' });
      if (screen.player_token_hash && tokenHash(bearer(req)) !== screen.player_token_hash) {
        return res.status(401).json({ error: 'Jeton player invalide' });
      }
      req.cxScreen = screen;
      next();
    } catch (error) { res.status(500).json({ error: error.message }); }
  }
  const findProvider = id => CATALOG.find(item => item.id === String(id || '').toLowerCase());

  // Catalogue admin stable : les futures intégrations pourront être ajoutées sans modifier l'UI principale.
  app.get('/api/v2/integrations/catalog', auth, (req, res) => {
    res.json({ version: 1, integrations: CATALOG });
  });
  app.get('/api/v2/integrations/:provider', auth, (req, res) => {
    const provider = findProvider(req.params.provider);
    if (!provider) return res.status(404).json({ error: 'Intégration inconnue' });
    res.json({ ...provider, configured: provider.status === 'ACTIVE' });
  });
  app.post('/api/v2/integrations/:provider/test', adminOnly, (req, res) => {
    const provider = findProvider(req.params.provider);
    if (!provider) return res.status(404).json({ error: 'Intégration inconnue' });
    if (provider.status !== 'ACTIVE') return res.status(501).json({ error: 'Intégration prévue mais pas encore activée', provider });
    res.json({ ok: true, provider: provider.id, note: 'La source active est testée lors de son appel par le widget.' });
  });
  app.get('/api/v2/integrations/:provider/config', auth, (req, res) => {
    const provider = findProvider(req.params.provider);
    if (!provider) return res.status(404).json({ error: 'Intégration inconnue' });
    res.json({ provider: provider.id, configured: provider.status === 'ACTIVE', config: {} });
  });
  app.put('/api/v2/integrations/:provider/config', adminOnly, (req, res) => {
    const provider = findProvider(req.params.provider);
    if (!provider) return res.status(404).json({ error: 'Intégration inconnue' });
    return res.status(501).json({ error: 'Stockage sécurisé de configuration réservé à une prochaine migration', provider });
  });

  // Catalogue destiné au player. Aucun secret ni configuration sensible n'est exposé.
  app.get('/api/player/:code/v2/integrations', playerOnly, (req, res) => {
    res.json({ version: 1, screen_id: req.cxScreen.id, integrations: CATALOG.map(({ id, label, category, status, playerRoute }) => ({ id, label, category, status, playerRoute: playerRoute || null })) });
  });
  app.get('/api/player/:code/v2/integrations/:provider/status', playerOnly, (req, res) => {
    const provider = findProvider(req.params.provider);
    if (!provider) return res.status(404).json({ error: 'Intégration inconnue' });
    res.json({ id: provider.id, status: provider.status, available: provider.status === 'ACTIVE' });
  });
  app.get('/api/player/:code/v2/integrations/:provider/data', playerOnly, (req, res) => {
    const provider = findProvider(req.params.provider);
    if (!provider) return res.status(404).json({ error: 'Intégration inconnue' });
    if (provider.status === 'ACTIVE') {
      return res.status(400).json({ error: 'Utilisez la route widget-data active indiquée dans le catalogue', playerRoute: provider.playerRoute });
    }
    res.status(501).json({ error: 'Route réservée pour une intégration future', provider: provider.id });
  });
}

module.exports = { register, CATALOG };

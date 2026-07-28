'use strict';

const PROVIDERS = Object.freeze({
  weather: { status: 'ACTIVE', category: 'DATA', label: 'Météo', player_data_route: '/api/player/:code/v2/widget-data?type=WEATHER' },
  rss: { status: 'ACTIVE', category: 'DATA', label: 'Flux RSS', player_data_route: '/api/player/:code/v2/widget-data?type=RSS' },
  traffic: { status: 'PLANNED', category: 'DATA', label: 'Trafic' },
  calendar: { status: 'PLANNED', category: 'DATA', label: 'Calendrier' },
  social: { status: 'PLANNED', category: 'SOCIAL', label: 'Réseaux sociaux' },
  qr_to_screen: { status: 'PLANNED', category: 'INTERACTION', label: 'QR to Screen' },
  webhook: { status: 'PLANNED', category: 'AUTOMATION', label: 'Webhooks' },
  custom_api: { status: 'PLANNED', category: 'DEVELOPER', label: 'API personnalisée' }
});

function register({ app, q, auth, adminOnly }) {
  const providerOr404 = (req, res) => {
    const key = String(req.params.provider || '').trim().toLowerCase();
    const provider = PROVIDERS[key];
    if (!provider) { res.status(404).json({ error: 'Intégration inconnue' }); return null; }
    return { key, ...provider };
  };
  const planned = (req, res, provider, action) => res.status(501).json({
    error: 'Intégration préparée mais pas encore activée',
    provider: provider.key,
    action,
    status: provider.status
  });

  app.get('/api/v2/integrations/catalog', auth, (_req, res) => {
    res.json({ version: 1, integrations: Object.entries(PROVIDERS).map(([key, value]) => ({ key, ...value })) });
  });
  app.get('/api/v2/integrations/:provider', auth, (req, res) => {
    const provider = providerOr404(req, res); if (!provider) return;
    res.json(provider);
  });
  app.get('/api/v2/integrations/:provider/config', auth, (req, res) => {
    const provider = providerOr404(req, res); if (!provider) return;
    planned(req, res, provider, 'READ_CONFIG');
  });
  app.put('/api/v2/integrations/:provider/config', adminOnly, (req, res) => {
    const provider = providerOr404(req, res); if (!provider) return;
    planned(req, res, provider, 'WRITE_CONFIG');
  });
  app.post('/api/v2/integrations/:provider/test', adminOnly, (req, res) => {
    const provider = providerOr404(req, res); if (!provider) return;
    planned(req, res, provider, 'TEST');
  });

  app.get('/api/player/:code/v2/integrations', async (req, res) => {
    try {
      const screen = await q('SELECT id FROM cx_screens WHERE pairing_code=$1', [String(req.params.code || '').trim().toUpperCase()]);
      if (!screen.rows[0]) return res.status(404).json({ error: 'Code introuvable' });
      res.json({ version: 1, integrations: Object.entries(PROVIDERS).map(([key, value]) => ({ key, status: value.status })) });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });
  app.get('/api/player/:code/v2/integrations/:provider/status', async (req, res) => {
    try {
      const screen = await q('SELECT id FROM cx_screens WHERE pairing_code=$1', [String(req.params.code || '').trim().toUpperCase()]);
      if (!screen.rows[0]) return res.status(404).json({ error: 'Code introuvable' });
      const provider = providerOr404(req, res); if (!provider) return;
      res.json({ provider: provider.key, status: provider.status });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });
  app.get('/api/player/:code/v2/integrations/:provider/data', async (req, res) => {
    try {
      const screen = await q('SELECT id FROM cx_screens WHERE pairing_code=$1', [String(req.params.code || '').trim().toUpperCase()]);
      if (!screen.rows[0]) return res.status(404).json({ error: 'Code introuvable' });
      const provider = providerOr404(req, res); if (!provider) return;
      if (provider.key === 'weather' || provider.key === 'rss') {
        return res.status(409).json({ error: 'Utiliser la route widget-data existante', route: provider.player_data_route });
      }
      planned(req, res, provider, 'PLAYER_DATA');
    } catch (error) { res.status(500).json({ error: error.message }); }
  });
}

module.exports = { register, PROVIDERS };

'use strict';
const crypto = require('crypto');
const tokenHash = token => crypto.createHash('sha256').update(String(token || '')).digest('hex');
const bearer = req => { const h = String(req.headers.authorization || ''); return h.startsWith('Bearer ') ? h.slice(7).trim() : ''; };

function register({ app, q, auth, adminOnly }) {
  const role = req => String(req.session?.userRole || '').toUpperCase();
  const clientId = req => req.session?.clientId || null;
  const isSuper = req => ['SUPER_ADMIN', 'SUPER'].includes(role(req));
  const allowedLevels = new Set(['INFO', 'WARN', 'ERROR']);

  async function resolvePlayer(req, res) {
    const code = String(req.params.code || '').trim().toUpperCase();
    const screen = (await q('SELECT id,player_token_hash FROM cx_screens WHERE pairing_code=$1', [code])).rows[0];
    if (!screen) { res.status(404).json({ error: 'Code introuvable' }); return null; }
    const token = bearer(req);
    if (screen.player_token_hash && tokenHash(token) !== screen.player_token_hash) { res.status(401).json({ error: 'Jeton player invalide' }); return null; }
    return screen;
  }

  app.post('/api/player/:code/technical-logs', async (req, res) => {
    try {
      const screen = await resolvePlayer(req, res); if (!screen) return;
      const entries = Array.isArray(req.body?.entries) ? req.body.entries.slice(0, 500) : [];
      if (!entries.length) return res.json({ ok: true, inserted: 0 });
      let inserted = 0;
      for (const e of entries) {
        const level = allowedLevels.has(String(e.level || '').toUpperCase()) ? String(e.level).toUpperCase() : 'INFO';
        const occurredAt = e.occurred_at && !Number.isNaN(Date.parse(e.occurred_at)) ? e.occurred_at : new Date().toISOString();
        await q(`INSERT INTO cx_player_logs(screen_id,level,category,message,details,occurred_at,created_at)
          VALUES($1,$2,$3,$4,$5,$6,NOW())`, [screen.id, level, String(e.category || 'PLAYER').slice(0,80), String(e.message || '').slice(0,1000), JSON.stringify(e.details || {}), occurredAt]);
        inserted += 1;
      }
      await q('DELETE FROM cx_player_logs WHERE id IN (SELECT id FROM cx_player_logs WHERE screen_id=$1 ORDER BY occurred_at DESC OFFSET 5000)', [screen.id]);
      res.json({ ok: true, inserted });
    } catch (error) { console.error('[V0.9 logs ingest]', error); res.status(500).json({ error: error.message }); }
  });

  app.get('/api/v32/monitoring/screens/:id/logs', auth, async (req, res) => {
    try {
      const params = [Number(req.params.id)];
      let guard = '';
      if (!isSuper(req)) { params.push(clientId(req)); guard = ` AND s.client_id=$${params.length}`; }
      const exists = (await q(`SELECT s.id FROM cx_screens s WHERE s.id=$1${guard}`, params)).rows[0];
      if (!exists) return res.status(404).json({ error: 'Écran introuvable' });
      const lp = [Number(req.params.id)];
      let where = 'screen_id=$1';
      if (req.query.level && allowedLevels.has(String(req.query.level).toUpperCase())) { lp.push(String(req.query.level).toUpperCase()); where += ` AND level=$${lp.length}`; }
      if (req.query.search) { lp.push('%' + String(req.query.search).slice(0,100) + '%'); where += ` AND (message ILIKE $${lp.length} OR category ILIKE $${lp.length})`; }
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 150));
      const rows = (await q(`SELECT id,level,category,message,details,occurred_at FROM cx_player_logs WHERE ${where} ORDER BY occurred_at DESC LIMIT ${limit}`, lp)).rows;
      res.json(rows);
    } catch (error) { console.error('[V0.9 logs read]', error); res.status(500).json({ error: error.message }); }
  });

  app.delete('/api/v32/monitoring/screens/:id/logs', adminOnly, async (req, res) => {
    try { await q('DELETE FROM cx_player_logs WHERE screen_id=$1', [Number(req.params.id)]); res.json({ ok: true }); }
    catch (error) { res.status(500).json({ error: error.message }); }
  });

  app.get('/api/v32/monitoring/screens/:id/logs.csv', auth, async (req, res) => {
    try {
      const params = [Number(req.params.id)]; let guard = '';
      if (!isSuper(req)) { params.push(clientId(req)); guard = ` AND s.client_id=$${params.length}`; }
      const screen = (await q(`SELECT s.id,s.name FROM cx_screens s WHERE s.id=$1${guard}`, params)).rows[0];
      if (!screen) return res.status(404).json({ error: 'Écran introuvable' });
      const rows = (await q('SELECT occurred_at,level,category,message,details FROM cx_player_logs WHERE screen_id=$1 ORDER BY occurred_at DESC LIMIT 10000', [screen.id])).rows;
      const quote = v => `"${String(v ?? '').replaceAll('"','""')}"`;
      const csv = ['Date;Niveau;Catégorie;Message;Détails', ...rows.map(r => [r.occurred_at,r.level,r.category,r.message,JSON.stringify(r.details || {})].map(quote).join(';'))].join('\n');
      res.setHeader('Content-Disposition', `attachment; filename="cx-view-logs-${screen.id}.csv"`);
      res.type('text/csv; charset=utf-8').send('\ufeff' + csv);
    } catch (error) { res.status(500).json({ error: error.message }); }
  });
}
module.exports = { register };

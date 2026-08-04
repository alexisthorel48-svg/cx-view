'use strict';

function register({ app, q, auth, adminOnly, notifyPlayer }) {
  const clamp = (value, min, max, fallback) => {
    const n = Number(value);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : fallback;
  };
  const nullableId = value => value === '' || value === null || value === undefined ? null : Number(value);
  const allowed = (value, choices, fallback) => choices.includes(value) ? value : fallback;

  app.get('/api/v242/screens/:id/config', auth, async (req, res) => {
    try {
      const r = await q(`SELECT s.*,
        pa.name playlist_a_name, pb.name playlist_b_name,
        aw.name assigned_workspace_name
        FROM cx_screens s
        LEFT JOIN cx_playlists pa ON pa.id=s.playlist_a_id
        LEFT JOIN cx_playlists pb ON pb.id=s.playlist_b_id
        LEFT JOIN LATERAL (
          SELECT workspace_id FROM cx_screen_assignments a
          WHERE a.screen_id=s.id AND a.active=true
            AND (a.starts_at IS NULL OR a.starts_at<=NOW())
            AND (a.ends_at IS NULL OR a.ends_at>NOW())
          ORDER BY a.created_at DESC LIMIT 1
        ) ass ON true
        LEFT JOIN cx_workspaces aw ON aw.id=ass.workspace_id
        WHERE s.id=$1`, [req.params.id]);
      if (!r.rows[0]) return res.status(404).json({ error: 'Écran introuvable' });
      const screen = r.rows[0];
      if (screen.layout === 'DOUBLE_H') screen.layout = 'VERTICAL';
      if (screen.layout === 'DOUBLE_V') screen.layout = 'HORIZONTAL';
      res.json(screen);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/v242/playlists', auth, async (_req, res) => {
    try {
      const r = await q(`SELECT p.id,p.name,p.client_id,c.name client_name,
        COUNT(pi.id)::int item_count
        FROM cx_playlists p
        LEFT JOIN cx_clients c ON c.id=p.client_id
        LEFT JOIN cx_playlist_items pi ON pi.playlist_id=p.id
        GROUP BY p.id,c.name ORDER BY p.name`);
      res.json(r.rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Liste volontairement simple et sans JOIN sur les items : cette route sert uniquement
  // au sélecteur d'affectation d'une playlist à un écran.
  app.get('/api/v242/screen-playlists', auth, async (_req, res) => {
    try {
      const r = await q(`SELECT p.id, p.name, p.client_id, c.name AS client_name
        FROM cx_playlists p
        LEFT JOIN cx_clients c ON c.id = p.client_id
        ORDER BY LOWER(p.name), p.id`);
      res.set('Cache-Control', 'no-store');
      res.json(r.rows);
    } catch (e) {
      console.error('[V242][SCREEN_PLAYLISTS]', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.put('/api/v242/screens/:id/config', adminOnly, async (req, res) => {
    try {
      const current = await q('SELECT * FROM cx_screens WHERE id=$1', [req.params.id]);
      if (!current.rows[0]) return res.status(404).json({ error: 'Écran introuvable' });
      const old = current.rows[0];
      const width = clamp(req.body.width_px, 100, 32768, Number(old.width_px) || 1920);
      const height = clamp(req.body.height_px, 100, 32768, Number(old.height_px) || 1080);
      const requestedLayout = String(req.body.layout || '').toUpperCase();
      const layoutAliases = { DOUBLE_H: 'VERTICAL', DOUBLE_V: 'HORIZONTAL' };
      const layout = allowed(layoutAliases[requestedLayout] || requestedLayout, ['SINGLE','VERTICAL','HORIZONTAL'], old.layout || 'SINGLE');
      const split = clamp(req.body.zone_split_percent, 10, 90, 50);
      const playlistB = layout === 'SINGLE' ? null : nullableId(req.body.playlist_b_id);
      const crop = (prefix, side) => clamp(req.body[`${prefix}_crop_${side}`], 0, 32768, 0);
      const cropMode = prefix => allowed(req.body[`${prefix}_crop_mode`], ['HIDE','FIT'], 'HIDE');

      const r = await q(`UPDATE cx_screens SET
        name=$1,width_px=$2,height_px=$3,orientation=$4,layout=$5,
        playlist_a_id=$6,playlist_b_id=$7,standby_color=$8,monitor_id=$9,
        player_window_mode='WINDOW',display_mode='WINDOW',window_x=$10,window_y=$11,
        window_width_px=$2,window_height_px=$3,window_corner_mode='SQUARE',
        window_corner_radius_px=0,always_on_top=TRUE,hide_cursor=TRUE,
        zone_a_name=$12,zone_b_name=$13,zone_split_percent=$14,
        zone_a_crop_top=$15,zone_a_crop_right=$16,zone_a_crop_bottom=$17,zone_a_crop_left=$18,
        zone_b_crop_top=$19,zone_b_crop_right=$20,zone_b_crop_bottom=$21,zone_b_crop_left=$22,
        zone_a_crop_mode=$23,zone_b_crop_mode=$24,
        sync_version=COALESCE(sync_version,0)+1,
        config_version=COALESCE(config_version,1)+1
        WHERE id=$25 RETURNING *`, [
          String(req.body.name || old.name).trim(), width, height,
          clamp(req.body.orientation, 0, 359, Number(old.orientation)||0), layout,
          nullableId(req.body.playlist_a_id), playlistB,
          /^#[0-9a-f]{6}$/i.test(req.body.standby_color || '') ? req.body.standby_color : '#000000',
          clamp(req.body.monitor_id, 0, 32, Number(old.monitor_id)||0),
          clamp(req.body.window_x, -32768, 32768, 0), clamp(req.body.window_y, -32768, 32768, 0),
          String(req.body.zone_a_name || 'Zone A').trim() || 'Zone A',
          String(req.body.zone_b_name || 'Zone B').trim() || 'Zone B', split,
          crop('zone_a','top'), crop('zone_a','right'), crop('zone_a','bottom'), crop('zone_a','left'),
          crop('zone_b','top'), crop('zone_b','right'), crop('zone_b','bottom'), crop('zone_b','left'),
          cropMode('zone_a'), cropMode('zone_b'), req.params.id
        ]);
      notifyPlayer(r.rows[0].pairing_code, { type: 'sync', screenId: r.rows[0].id });
      res.json(r.rows[0]);
    } catch (e) {
      console.error('[V242][SCREEN_CONFIG_SAVE]', { screen_id: req.params.id, layout: req.body.layout, error: e.message });
      const hint = String(e.constraint || '').includes('layout')
        ? 'La contrainte SQL des dispositions est obsolète. Exécuter npm run migrate:1.3.1.'
        : undefined;
      res.status(400).json({ error: e.message, code: e.code || null, constraint: e.constraint || null, hint });
    }
  });
}

module.exports = { register };

function register({ app, q, auth }) {
  const role = req => String(req.session?.userRole || '').toUpperCase();
  const clientId = req => req.session?.clientId || null;
  const isSuper = req => ['SUPER_ADMIN', 'SUPER'].includes(role(req));
  const int = value => Number.parseInt(value, 10) || 0;
  const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  const validTime = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
  const log = (label, error) => console.error(`[V0.9.0] ${label}:`, error);

  function buildFilters(req, alias = 'l') {
    const params = [];
    const clauses = ['1=1'];
    const add = (sql, value) => { params.push(value); clauses.push(sql.replace('?', `$${params.length}`)); };
    if (!isSuper(req)) add('s.client_id=?', clientId(req));
    else if (req.query.client_id) add('s.client_id=?', int(req.query.client_id));
    if (req.query.screen_id) add(`${alias}.screen_id=?`, int(req.query.screen_id));
    if (req.query.media_id) add(`${alias}.media_id=?`, int(req.query.media_id));
    if (req.query.group_id) add('s.group_id=?', int(req.query.group_id));
    if (req.query.site_id) add('s.site_id=?', int(req.query.site_id));
    if (validDate(req.query.from)) add(`${alias}.played_at>=?::date`, req.query.from);
    if (validDate(req.query.to)) add(`${alias}.played_at<(?::date + INTERVAL '1 day')`, req.query.to);
    const fromTime = validTime(req.query.from_time) ? req.query.from_time : null;
    const toTime = validTime(req.query.to_time) ? req.query.to_time : null;
    if (fromTime && toTime) {
      params.push(fromTime, toTime);
      const a = `$${params.length-1}::time`; const b = `$${params.length}::time`;
      clauses.push(fromTime <= toTime
        ? `(${alias}.played_at AT TIME ZONE 'Europe/Brussels')::time >= ${a} AND (${alias}.played_at AT TIME ZONE 'Europe/Brussels')::time <= ${b}`
        : `(((${alias}.played_at AT TIME ZONE 'Europe/Brussels')::time >= ${a}) OR ((${alias}.played_at AT TIME ZONE 'Europe/Brussels')::time <= ${b}))`);
    } else if (fromTime) add(`(${alias}.played_at AT TIME ZONE 'Europe/Brussels')::time>=?::time`, fromTime);
    else if (toTime) add(`(${alias}.played_at AT TIME ZONE 'Europe/Brussels')::time<=?::time`, toTime);
    if (req.query.zone && ['A', 'B'].includes(String(req.query.zone).toUpperCase())) add(`${alias}.zone=?`, String(req.query.zone).toUpperCase());
    return { where: clauses.join(' AND '), params };
  }

  app.get('/api/v30/reports/options', auth, async (req, res) => {
    try {
      const p = [];
      let scope = '';
      if (!isSuper(req)) { p.push(clientId(req)); scope = ' WHERE s.client_id=$1'; }
      const [screens, clients, groups, sites, media] = await Promise.all([
        q(`SELECT s.id,s.name,s.client_id,s.group_id,s.site_id,c.name client_name FROM cx_screens s LEFT JOIN cx_clients c ON c.id=s.client_id${scope} ORDER BY s.name`, p),
        isSuper(req) ? q('SELECT id,name FROM cx_clients ORDER BY name') : q('SELECT id,name FROM cx_clients WHERE id=$1', [clientId(req)]),
        q(`SELECT DISTINCT g.id,g.name FROM cx_screen_groups g JOIN cx_screens s ON s.group_id=g.id${scope} ORDER BY g.name`, p),
        q(`SELECT DISTINCT st.id,st.name FROM cx_sites st JOIN cx_screens s ON s.site_id=st.id${scope} ORDER BY st.name`, p),
        q(`SELECT DISTINCT m.id,m.title FROM cx_logs l JOIN cx_screens s ON s.id=l.screen_id JOIN cx_media m ON m.id=l.media_id${scope ? scope.replace(' WHERE ', ' WHERE ') : ''} ORDER BY m.title`, p)
      ]);
      res.json({ screens: screens.rows, clients: clients.rows, groups: groups.rows, sites: sites.rows, media: media.rows });
    } catch (e) { log('options', e); res.status(500).json({ error: e.message }); }
  });

  app.get('/api/v30/reports/summary', auth, async (req, res) => {
    try {
      const f = buildFilters(req);
      const base = `FROM cx_logs l LEFT JOIN cx_screens s ON s.id=l.screen_id LEFT JOIN cx_media m ON m.id=l.media_id LEFT JOIN cx_playlists p ON p.id=l.playlist_id LEFT JOIN cx_clients c ON c.id=s.client_id WHERE ${f.where}`;
      const [summary, media, screens, days, recent] = await Promise.all([
        q(`SELECT COUNT(*)::int play_count,COUNT(DISTINCT l.media_id)::int media_count,COUNT(DISTINCT l.screen_id)::int screen_count,MIN(l.played_at) first_play,MAX(l.played_at) last_play ${base}`, f.params),
        q(`SELECT m.id,m.title,m.media_type,COUNT(*)::int play_count,COUNT(DISTINCT l.screen_id)::int screen_count,MAX(l.played_at) last_play ${base} GROUP BY m.id,m.title,m.media_type ORDER BY play_count DESC,m.title LIMIT 100`, f.params),
        q(`SELECT s.id,s.name,c.name client_name,COUNT(*)::int play_count,COUNT(DISTINCT l.media_id)::int media_count,MAX(l.played_at) last_play ${base} GROUP BY s.id,s.name,c.name ORDER BY play_count DESC,s.name LIMIT 100`, f.params),
        q(`SELECT TO_CHAR(l.played_at AT TIME ZONE 'Europe/Brussels','YYYY-MM-DD') AS "day",COUNT(*)::int play_count ${base} GROUP BY 1 ORDER BY 1`, f.params),
        q(`SELECT l.id,l.played_at,l.zone,l.event,s.name screen_name,c.name client_name,m.title media_title,p.name playlist_name ${base} ORDER BY l.played_at DESC LIMIT 250`, f.params)
      ]);
      res.json({ summary: summary.rows[0], media: media.rows, screens: screens.rows, days: days.rows, recent: recent.rows });
    } catch (e) { log('summary', e); res.status(500).json({ error: e.message }); }
  });

  app.get('/api/v30/reports/proof-of-play.csv', auth, async (req, res) => {
    try {
      const f = buildFilters(req);
      const r = await q(`SELECT l.played_at,s.name screen,c.name client,m.title media,p.name playlist,l.zone,l.event
        FROM cx_logs l LEFT JOIN cx_screens s ON s.id=l.screen_id LEFT JOIN cx_clients c ON c.id=s.client_id
        LEFT JOIN cx_media m ON m.id=l.media_id LEFT JOIN cx_playlists p ON p.id=l.playlist_id
        WHERE ${f.where} ORDER BY l.played_at DESC LIMIT 100000`, f.params);
      const csv = ['Date;Écran;Client;Média;Playlist;Zone;Événement', ...r.rows.map(row => [row.played_at,row.screen,row.client,row.media,row.playlist,row.zone,row.event].map(v => `"${String(v ?? '').replaceAll('"','""')}"`).join(';'))].join('\n');
      const stamp = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Disposition', `attachment; filename="cx-view-preuve-diffusion-${stamp}.csv"`);
      res.type('text/csv; charset=utf-8').send('\ufeff' + csv);
    } catch (e) { log('csv', e); res.status(500).json({ error: e.message }); }
  });
}
module.exports = { register };

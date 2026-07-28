'use strict';

const crypto = require('crypto');

const PROTOCOL_VERSION = 2;
const ENGINE_VERSION = '0.18.1';

function register({ app, q, PUBLIC_BASE_URL }) {
  const asNumber = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const parseJson = (value, fallback = {}) => {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    try { return JSON.parse(value); } catch (_) { return fallback; }
  };
  const sha256 = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const tokenHash = token => crypto.createHash('sha256').update(String(token || '')).digest('hex');
  const bearer = req => { const h = String(req.headers.authorization || ''); return h.startsWith('Bearer ') ? h.slice(7).trim() : ''; };
  async function authenticatePlayer(req, res) {
    const code = String(req.params.code || '').trim().toUpperCase();
    const found = await q('SELECT * FROM cx_screens WHERE pairing_code=$1', [code]);
    const screen = found.rows[0];
    if (!screen) { res.status(404).json({ error: 'Code introuvable' }); return null; }
    const token = bearer(req);
    if (screen.player_token_hash && tokenHash(token) !== screen.player_token_hash) {
      res.status(401).json({ error: 'Jeton player invalide' }); return null;
    }
    return screen;
  }
  const baseUrlFor = req => String(PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');

  function zonedParts(date, timezone) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone || 'Europe/Brussels',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      hourCycle: 'h23', weekday: 'short'
    }).formatToParts(date).reduce((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});
    const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      time: `${parts.hour}:${parts.minute}`,
      weekday: weekdayMap[parts.weekday]
    };
  }

  function timeMatches(from, to, nowTime) {
    if (!from && !to) return true;
    const start = String(from || '00:00').slice(0, 5);
    const end = String(to || '23:59').slice(0, 5);
    if (start === end) return true;
    if (start < end) return nowTime >= start && nowTime < end;
    return nowTime >= start || nowTime < end; // plage passant minuit
  }

  function ruleMatches(rule, now) {
    if (!rule.active) return false;
    const timezone = rule.timezone || 'Europe/Brussels';
    let local;
    try { local = zonedParts(now, timezone); }
    catch (_) { local = zonedParts(now, 'Europe/Brussels'); }
    const startDate = rule.start_date ? String(rule.start_date).slice(0, 10) : null;
    const endDate = rule.end_date ? String(rule.end_date).slice(0, 10) : null;
    if (startDate && local.date < startDate) return false;
    if (endDate && local.date > endDate) return false;
    const days = String(rule.days || 'all');
    if (days !== 'all' && !days.split(',').map(x => Number(x)).includes(local.weekday)) return false;
    return timeMatches(rule.time_from, rule.time_to, local.time);
  }

  async function playlistPayload(playlistId, baseUrl) {
    if (!playlistId) return null;
    const playlistResult = await q('SELECT id,name,created_at AS updated_at FROM cx_playlists WHERE id=$1', [playlistId]);
    const playlist = playlistResult.rows[0];
    if (!playlist) return null;
    const itemResult = await q(
      `SELECT pi.*,m.title,m.file_name,m.thumbnail_name,m.mime_type,m.media_type,m.bytes AS file_size
       FROM cx_playlist_items pi
       LEFT JOIN cx_media m ON m.id=pi.media_id
       WHERE pi.playlist_id=$1 AND pi.active=true
       ORDER BY pi.position ASC,pi.id ASC`, [playlistId]
    );
    const items = itemResult.rows.map(row => {
      const itemType = String(row.item_type || 'MEDIA').toUpperCase();
      const widgetConfig = parseJson(row.widget_config, {});
      return {
        id: row.id,
        type: itemType,
        renderer: itemType === 'WIDGET' ? 'WIDGET' : (itemType === 'WEB' ? 'WEB' : 'MEDIA'),
        position: asNumber(row.position),
        duration_seconds: Math.max(1, asNumber(row.duration_seconds, 10)),
        play_forever: !!row.play_forever,
        media: row.media_id ? {
          id: row.media_id,
          title: row.title,
          media_type: row.media_type,
          mime_type: row.mime_type,
          size: asNumber(row.file_size),
          file_name: row.file_name || null,
          url: row.file_name ? `${baseUrl}/files/uploads/${encodeURIComponent(row.file_name)}` : null,
          thumbnail_url: row.thumbnail_name ? `${PUBLIC_BASE_URL}/files/thumbs/${row.thumbnail_name}` : null
        } : null,
        widget: itemType === 'WIDGET' ? {
          type: String(row.widget_type || widgetConfig.type || 'CUSTOM').toUpperCase(),
          config: widgetConfig
        } : null,
        schedule: {
          start: row.schedule_start || null,
          end: row.schedule_end || null,
          days: row.schedule_days || 'all',
          time_from: row.schedule_time_from || null,
          time_to: row.schedule_time_to || null
        },
        priority: {
          enabled: !!row.is_priority,
          interval_minutes: asNumber(row.priority_interval_minutes),
          count: asNumber(row.priority_count)
        }
      };
    });
    const payload = { id: playlist.id, name: playlist.name, updated_at: playlist.updated_at, items };
    return { ...payload, hash: sha256(payload) };
  }


  async function activeSceneForScreen(screenId, baseUrl) {
    const sr = await q(`SELECT sc.* FROM cx_screen_scenes ss
      JOIN cx_scenes sc ON sc.id=ss.scene_id AND sc.active=true
      WHERE ss.screen_id=$1 AND ss.active=true LIMIT 1`, [screenId]);
    const scene = sr.rows[0];
    if (!scene) return null;
    const zr = await q(`SELECT id,name,content_type,playlist_id,content_value,x,y,width,height,layer,muted,fit
      FROM cx_scene_zones WHERE scene_id=$1 ORDER BY layer,id`, [scene.id]);
    const zones = [];
    for (const z of zr.rows) {
      let playlist = null;
      if (z.playlist_id) playlist = await playlistPayload(z.playlist_id, baseUrl);
      const type = String(z.content_type || 'playlist').toLowerCase();
      let direct = null;
      if (!playlist && type !== 'playlist') {
        const map = {clock:'CLOCK',weather:'WEATHER',rss:'RSS',web:'WEBPAGE',text:'TICKER'};
        if (map[type]) direct = {
          id: `scene-${scene.id}-zone-${z.id}`, name: z.name, updated_at: scene.updated_at, hash: '',
          items: [{ id:`zone-${z.id}`, type:type==='web'?'WEB':'WIDGET', renderer:type==='web'?'WEB':'WIDGET', duration_seconds:86400,
            widget:{type:map[type], config:{name:z.name, value:z.content_value, url:z.content_value, city:z.content_value, text:z.content_value}} }]
        };
      }
      zones.push({ id:z.id, name:z.name, x:Number(z.x), y:Number(z.y), width:Number(z.width), height:Number(z.height), layer:Number(z.layer||0), fit:z.fit||'contain', muted:z.muted!==false, playlist:playlist||direct });
    }
    return { id:scene.id, name:scene.name, width:Number(scene.width||1920), height:Number(scene.height||1080), background:scene.background||'#000000', zones };
  }

  async function activeCampaignsForScreen(screenId, now) {
    const result = await q(
      `SELECT r.*,p.name AS playlist_name
       FROM cx_screen_schedule_rules r
       JOIN cx_playlists p ON p.id=r.playlist_id
       WHERE r.screen_id=$1 AND r.active=true
       ORDER BY r.zone ASC,r.priority DESC,r.updated_at DESC,r.id DESC`, [screenId]
    );
    return result.rows.filter(rule => ruleMatches(rule, now));
  }

  app.get('/api/player/:code/v2/config', async (req, res) => {
    try {
      const screen = await authenticatePlayer(req, res);
      if (!screen) return;
      const baseUrl = baseUrlFor(req);

      const now = new Date();
      const scene = await activeSceneForScreen(screen.id, baseUrl);
      const activeRules = await activeCampaignsForScreen(screen.id, now);
      const selected = { A: null, B: null };
      for (const rule of activeRules) {
        const zone = rule.zone === 'B' ? 'B' : 'A';
        if (!selected[zone]) selected[zone] = rule;
      }

      const fallback = {
        A: screen.playlist_a_id || null,
        B: screen.layout !== 'SINGLE' ? (screen.playlist_b_id || null) : null
      };
      const selectedPlaylistIds = {
        A: selected.A ? selected.A.playlist_id : fallback.A,
        B: screen.layout !== 'SINGLE' ? (selected.B ? selected.B.playlist_id : fallback.B) : null
      };
      const [playlistA, playlistB] = await Promise.all([
        playlistPayload(selectedPlaylistIds.A, baseUrl),
        playlistPayload(selectedPlaylistIds.B, baseUrl)
      ]);

      const campaignShape = rule => rule ? {
        uid: rule.campaign_uid || `legacy-${rule.id}`,
        name: rule.name,
        playlist_id: rule.playlist_id,
        playlist_name: rule.playlist_name,
        priority: asNumber(rule.priority, 100),
        timezone: rule.timezone || 'Europe/Brussels',
        start_date: rule.start_date,
        end_date: rule.end_date,
        days: rule.days || 'all',
        time_from: rule.time_from,
        time_to: rule.time_to
      } : null;

      const config = {
        protocol_version: PROTOCOL_VERSION,
        engine_version: ENGINE_VERSION,
        generated_at: now.toISOString(),
        sync_version: asNumber(screen.sync_version),
        screen: {
          id: screen.id,
          name: screen.name,
          width: asNumber(screen.width_px, 1920),
          width_px: asNumber(screen.width_px, 1920),
          height: asNumber(screen.height_px, 1080),
          height_px: asNumber(screen.height_px, 1080),
          orientation: screen.orientation || 'LANDSCAPE',
          layout: screen.layout || 'SINGLE',
          standby_color: screen.standby_color || '#000000',
          display_mode: screen.display_mode || 'WINDOW',
          monitor_id: asNumber(screen.monitor_id),
          window_x: asNumber(screen.window_x), window_y: asNumber(screen.window_y),
          zone_split_percent: asNumber(screen.zone_split_percent, 50),
          zone_names: { A: screen.zone_a_name || 'Zone A', B: screen.zone_b_name || 'Zone B' },
          fallback_playlists: fallback
        },
        scene,
        zones: {
          A: { campaign: campaignShape(selected.A), fallback: !selected.A, playlist: playlistA },
          B: screen.layout !== 'SINGLE'
            ? { campaign: campaignShape(selected.B), fallback: !selected.B, playlist: playlistB }
            : null
        },
        scheduler: {
          source: activeRules.length ? 'CAMPAIGNS' : 'FALLBACK',
          active_campaign_count: activeRules.length,
          evaluated_at: now.toISOString()
        }
      };
      const configHash = sha256(config);
      const clientHash = String(req.query.hash || '').trim();

      await q(
        `UPDATE cx_screens
         SET last_seen_at=NOW(),player_version=COALESCE(NULLIF($1,''),player_version),
             protocol_version=$2,last_config_hash=$3,last_config_at=NOW()
         WHERE id=$4`,
        [String(req.query.player_version || ''), PROTOCOL_VERSION, configHash, screen.id]
      );

      if (clientHash && clientHash === configHash) {
        return res.json({ changed: false, protocol_version: PROTOCOL_VERSION, engine_version: ENGINE_VERSION, hash: configHash, sync_version: config.sync_version });
      }
      res.json({ changed: true, hash: configHash, config });
    } catch (error) {
      console.error('[V0.18 Core Engine]', error);
      res.status(500).json({ error: error.message });
    }
  });


  app.get('/api/player/:code/v2/widget-data', async (req, res) => {
    try {
      const screen = await authenticatePlayer(req, res);
      if (!screen) return;
      const type = String(req.query.type || '').toUpperCase();
      if (type === 'WEATHER') {
        const city = String(req.query.city || 'Soignies').trim().slice(0, 120);
        const days = Math.max(1, Math.min(5, asNumber(req.query.days, 3)));
        const geoResponse = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=fr&format=json`);
        if (!geoResponse.ok) throw new Error(`Géocodage indisponible (${geoResponse.status})`);
        const geo = await geoResponse.json();
        const place = geo.results && geo.results[0];
        if (!place) return res.status(404).json({ error: `Ville introuvable : ${city}` });
        const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset&forecast_days=${days}&timezone=auto`;
        const weatherResponse = await fetch(weatherUrl);
        if (!weatherResponse.ok) throw new Error(`Météo indisponible (${weatherResponse.status})`);
        return res.json({ place: { name: place.name, admin1: place.admin1, country: place.country, timezone: place.timezone }, weather: await weatherResponse.json() });
      }
      if (type === 'RSS') {
        const url = String(req.query.url || '').trim();
        if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'URL RSS invalide' });
        const response = await fetch(url, { headers: { 'User-Agent': 'CX-View-Player/0.12' }, redirect: 'follow' });
        if (!response.ok) throw new Error(`Flux RSS indisponible (${response.status})`);
        const xml = await response.text();
        const clean = value => String(value || '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
        const blocks = [...xml.matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)].slice(0, 10).map(m => m[0]);
        const items = blocks.map(block => ({
          title: clean((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]),
          description: clean((block.match(/<(?:description|summary|content)[^>]*>([\s\S]*?)<\/(?:description|summary|content)>/i) || [])[1]),
          date: clean((block.match(/<(?:pubDate|published|updated)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated)>/i) || [])[1])
        })).filter(item => item.title);
        const title = clean((xml.match(/<channel[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i) || xml.match(/<feed[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1]);
        return res.json({ title, items });
      }
      return res.status(400).json({ error: 'Type de widget non pris en charge' });
    } catch (error) { res.status(502).json({ error: error.message }); }
  });

  app.get('/api/player/:code/v2/compatibility', async (req, res) => {
    try {
      const code = String(req.params.code || '').trim().toUpperCase();
      const found = await q('SELECT id FROM cx_screens WHERE pairing_code=$1', [code]);
      if (!found.rows[0]) return res.status(404).json({ error: 'Code introuvable' });
      const playerProtocol = asNumber(req.query.protocol, 1);
      res.json({
        compatible: playerProtocol === PROTOCOL_VERSION,
        server_protocol: PROTOCOL_VERSION,
        minimum_protocol: PROTOCOL_VERSION,
        engine_version: ENGINE_VERSION,
        action: playerProtocol === PROTOCOL_VERSION ? 'NONE' : 'UPDATE_REQUIRED'
      });
    } catch (error) { res.status(500).json({ error: error.message }); }
  });
}

module.exports = { register, PROTOCOL_VERSION, ENGINE_VERSION };

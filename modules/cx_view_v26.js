'use strict';
const crypto=require('crypto');
const tokenHash=token=>crypto.createHash('sha256').update(String(token||'')).digest('hex');
const bearer=req=>{const h=String(req.headers.authorization||'');return h.startsWith('Bearer ')?h.slice(7).trim():'';};

function register({ app, q, auth, adminOnly, notifyPlayer }) {
  const roleClient = req => req.session?.userRole === 'SUPER_ADMIN' ? null : (req.session?.clientId || null);
  const clamp = (value,min,max) => value == null || value === '' ? null : Math.max(min,Math.min(max,Number(value)));

  app.get('/api/v26/monitoring/summary', auth, async (req,res) => {
    try {
      const clientId=roleClient(req), params=[];
      let where=' WHERE 1=1';
      if(clientId){params.push(clientId);where+=` AND s.client_id=$${params.length}`;}
      const result=await q(`SELECT
        COUNT(*)::int total,
        COUNT(*) FILTER (WHERE s.last_seen_at>NOW()-INTERVAL '5 minutes')::int online,
        COUNT(*) FILTER (WHERE s.last_seen_at<=NOW()-INTERVAL '5 minutes' AND s.last_seen_at>NOW()-INTERVAL '30 minutes')::int delayed,
        COUNT(*) FILTER (WHERE s.last_seen_at IS NULL OR s.last_seen_at<=NOW()-INTERVAL '30 minutes')::int offline,
        COUNT(*) FILTER (WHERE t.disk_percent>=90 OR t.cpu_percent>=90 OR t.ram_percent>=90 OR NULLIF(t.last_error,'') IS NOT NULL)::int alerts
        FROM cx_screens s LEFT JOIN cx_screen_telemetry t ON t.screen_id=s.id${where}`,params);
      res.json(result.rows[0]);
    } catch(error){console.error('[V0.5 monitoring]', error);res.status(500).json({error:error.message});}
  });

  app.get('/api/v26/monitoring/screens', auth, async (req,res) => {
    try {
      const clientId=roleClient(req), params=[];
      let sql=`SELECT s.id,s.name,s.pairing_code,s.width_px,s.height_px,s.orientation,s.layout,s.last_seen_at,
        s.sync_version,s.client_id,s.group_id,c.name client_name,g.name group_name,
        pa.name playlist_a_name,pb.name playlist_b_name,
        t.player_version,t.os_version,t.ip_address,t.cpu_percent,t.ram_percent,t.ram_used_mb,t.ram_total_mb,
        t.disk_percent,t.disk_free_mb,t.disk_total_mb,t.cpu_temperature,t.uptime_seconds,t.current_zone,
        t.playback_state,t.eco_mode,t.last_sync_at,t.last_error,t.updated_at telemetry_updated_at,
        COALESCE(cp.name,pa.name) current_playlist_name,cm.title current_media_name,
        CASE WHEN s.last_seen_at>NOW()-INTERVAL '5 minutes' THEN 'online'
             WHEN s.last_seen_at>NOW()-INTERVAL '30 minutes' THEN 'delayed' ELSE 'offline' END status
        FROM cx_screens s
        LEFT JOIN cx_clients c ON c.id=s.client_id
        LEFT JOIN cx_screen_groups g ON g.id=s.group_id
        LEFT JOIN cx_playlists pa ON pa.id=s.playlist_a_id
        LEFT JOIN cx_playlists pb ON pb.id=s.playlist_b_id
        LEFT JOIN cx_screen_telemetry t ON t.screen_id=s.id
        LEFT JOIN cx_playlists cp ON cp.id=t.current_playlist_id
        LEFT JOIN cx_media cm ON cm.id=t.current_media_id WHERE 1=1`;
      if(clientId){params.push(clientId);sql+=` AND s.client_id=$${params.length}`;}
      if(req.query.client_id){params.push(Number(req.query.client_id));sql+=` AND s.client_id=$${params.length}`;}
      if(req.query.group_id){params.push(Number(req.query.group_id));sql+=` AND s.group_id=$${params.length}`;}
      if(req.query.status){params.push(req.query.status);sql+=` AND (CASE WHEN s.last_seen_at>NOW()-INTERVAL '5 minutes' THEN 'online' WHEN s.last_seen_at>NOW()-INTERVAL '30 minutes' THEN 'delayed' ELSE 'offline' END)=$${params.length}`;}
      if(req.query.search){params.push('%'+req.query.search+'%');sql+=` AND (s.name ILIKE $${params.length} OR s.pairing_code ILIKE $${params.length} OR COALESCE(c.name,'') ILIKE $${params.length} OR COALESCE(g.name,'') ILIKE $${params.length})`;}
      sql+=' ORDER BY CASE WHEN s.last_seen_at>NOW()-INTERVAL \'5 minutes\' THEN 0 WHEN s.last_seen_at>NOW()-INTERVAL \'30 minutes\' THEN 1 ELSE 2 END,s.name';
      res.json((await q(sql,params)).rows);
    } catch(error){console.error('[V0.5 monitoring]', error);res.status(500).json({error:error.message});}
  });

  app.get('/api/v26/monitoring/screens/:id', auth, async (req,res) => {
    try {
      const clientId=roleClient(req), params=[Number(req.params.id)];
      let guard=''; if(clientId){params.push(clientId);guard=` AND s.client_id=$${params.length}`;}
      const screen=(await q(`SELECT s.*,c.name client_name,g.name group_name,t.*,cp.name current_playlist_name,cm.title current_media_name,
        CASE WHEN s.last_seen_at>NOW()-INTERVAL '5 minutes' THEN 'online' WHEN s.last_seen_at>NOW()-INTERVAL '30 minutes' THEN 'delayed' ELSE 'offline' END status
        FROM cx_screens s LEFT JOIN cx_clients c ON c.id=s.client_id LEFT JOIN cx_screen_groups g ON g.id=s.group_id
        LEFT JOIN cx_screen_telemetry t ON t.screen_id=s.id LEFT JOIN cx_playlists cp ON cp.id=t.current_playlist_id
        LEFT JOIN cx_media cm ON cm.id=t.current_media_id WHERE s.id=$1${guard}`,params)).rows[0];
      if(!screen)return res.status(404).json({error:'Écran introuvable'});
      const history=(await q(`SELECT l.id,l.event,l.zone,l.played_at,m.title media_name,p.name playlist_name
        FROM cx_logs l LEFT JOIN cx_media m ON m.id=l.media_id LEFT JOIN cx_playlists p ON p.id=l.playlist_id
        WHERE l.screen_id=$1 ORDER BY l.played_at DESC LIMIT 30`,[req.params.id])).rows;
      res.json({screen,history});
    } catch(error){console.error('[V0.5 monitoring]', error);res.status(500).json({error:error.message});}
  });

  app.post('/api/v26/monitoring/screens/:id/sync', adminOnly, async (req,res) => {
    try {
      const screen=(await q(`UPDATE cx_screens SET sync_version=COALESCE(sync_version,0)+1 WHERE id=$1 RETURNING id,pairing_code,sync_version`,[req.params.id])).rows[0];
      if(!screen)return res.status(404).json({error:'Écran introuvable'});
      const realtime=notifyPlayer(screen.pairing_code,{type:'sync',screenId:screen.id});
      await q(`INSERT INTO cx_screen_telemetry(screen_id,last_sync_at,updated_at) VALUES($1,NOW(),NOW())
        ON CONFLICT(screen_id) DO UPDATE SET last_sync_at=NOW(),updated_at=NOW()`,[screen.id]);
      res.json({ok:true,realtime,sync_version:screen.sync_version});
    } catch(error){console.error('[V0.5 monitoring]', error);res.status(500).json({error:error.message});}
  });

  // Endpoint prêt pour le futur player. Il reste compatible avec le mode rebuild qui bloque /api/player/*.
  app.post('/api/player/:code/telemetry', async (req,res) => {
    try {
      const code=String(req.params.code||'').trim().toUpperCase();
      const screen=(await q('SELECT id,player_token_hash FROM cx_screens WHERE pairing_code=$1',[code])).rows[0];
      if(!screen)return res.status(404).json({error:'Code introuvable'});
      const token=bearer(req);
      if(screen.player_token_hash&&tokenHash(token)!==screen.player_token_hash)return res.status(401).json({error:'Jeton player invalide'});
      const b=req.body||{};
      await q(`INSERT INTO cx_screen_telemetry(
        screen_id,player_version,os_version,ip_address,cpu_percent,ram_percent,ram_used_mb,ram_total_mb,
        disk_percent,disk_free_mb,disk_total_mb,cpu_temperature,uptime_seconds,current_playlist_id,current_media_id,
        current_zone,playback_state,eco_mode,last_sync_at,last_error,extra,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
        ON CONFLICT(screen_id) DO UPDATE SET player_version=EXCLUDED.player_version,os_version=EXCLUDED.os_version,
        ip_address=EXCLUDED.ip_address,cpu_percent=EXCLUDED.cpu_percent,ram_percent=EXCLUDED.ram_percent,
        ram_used_mb=EXCLUDED.ram_used_mb,ram_total_mb=EXCLUDED.ram_total_mb,disk_percent=EXCLUDED.disk_percent,
        disk_free_mb=EXCLUDED.disk_free_mb,disk_total_mb=EXCLUDED.disk_total_mb,cpu_temperature=EXCLUDED.cpu_temperature,
        uptime_seconds=EXCLUDED.uptime_seconds,current_playlist_id=EXCLUDED.current_playlist_id,current_media_id=EXCLUDED.current_media_id,
        current_zone=EXCLUDED.current_zone,playback_state=EXCLUDED.playback_state,eco_mode=EXCLUDED.eco_mode,
        last_sync_at=COALESCE(EXCLUDED.last_sync_at,cx_screen_telemetry.last_sync_at),last_error=EXCLUDED.last_error,
        extra=EXCLUDED.extra,updated_at=NOW()`,[
          screen.id,b.player_version||null,b.os_version||null,req.ip||b.ip_address||null,
          clamp(b.cpu_percent,0,100),clamp(b.ram_percent,0,100),b.ram_used_mb||null,b.ram_total_mb||null,
          clamp(b.disk_percent,0,100),b.disk_free_mb||null,b.disk_total_mb||null,b.cpu_temperature||null,b.uptime_seconds||null,
          b.current_playlist_id||null,b.current_media_id||null,b.current_zone||null,b.playback_state||null,!!b.eco_mode,
          b.last_sync_at||null,b.last_error||null,JSON.stringify(b.extra||{})]);
      await q('UPDATE cx_screens SET last_seen_at=NOW() WHERE id=$1',[screen.id]);
      res.json({ok:true});
    } catch(error){console.error('[V0.5 monitoring]', error);res.status(500).json({error:error.message});}
  });
}
module.exports={register};

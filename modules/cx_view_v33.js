'use strict';
const crypto = require('crypto');
const tokenHash = token => crypto.createHash('sha256').update(String(token || '')).digest('hex');
const bearer = req => { const h=String(req.headers.authorization||''); return h.startsWith('Bearer ')?h.slice(7).trim():''; };
const num = (value,min=null,max=null) => {
  if(value===null||value===undefined||value==='') return null;
  let n=Number(value); if(!Number.isFinite(n)) return null;
  if(min!==null)n=Math.max(min,n); if(max!==null)n=Math.min(max,n); return n;
};
function register({ app, q, auth }) {
  async function authenticate(req,res){
    const code=String(req.params.code||'').trim().toUpperCase();
    const screen=(await q('SELECT id,pairing_code,player_token_hash,sync_version FROM cx_screens WHERE pairing_code=$1',[code])).rows[0];
    if(!screen){res.status(404).json({error:'Code introuvable'});return null;}
    const token=bearer(req);
    if(screen.player_token_hash && tokenHash(token)!==screen.player_token_hash){res.status(401).json({error:'Jeton player invalide'});return null;}
    return screen;
  }

  app.post('/api/player/:code/heartbeat', async (req,res) => {
    try {
      const screen=await authenticate(req,res); if(!screen)return;
      const b=req.body||{};
      const started=Date.now();
      await q(`INSERT INTO cx_screen_telemetry(
        screen_id,player_version,os_version,hostname,platform,architecture,timezone,local_time,
        ip_address,local_ip,public_ip,network_state,server_latency_ms,cpu_percent,ram_percent,
        ram_used_mb,ram_total_mb,process_memory_mb,disk_percent,disk_free_mb,disk_total_mb,
        cpu_temperature,uptime_seconds,screen_width_px,screen_height_px,screen_scale_factor,
        current_playlist_id,current_playlist_name,current_media_id,current_media_name,current_zone,
        playback_state,media_position_seconds,media_remaining_seconds,eco_mode,last_sync_at,last_error,
        cache_files,cache_bytes,download_state,download_current,download_total,heartbeat_sequence,boot_id,
        last_heartbeat_at,extra,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,NOW(),$45::jsonb,NOW())
        ON CONFLICT(screen_id) DO UPDATE SET
          player_version=EXCLUDED.player_version,os_version=EXCLUDED.os_version,hostname=EXCLUDED.hostname,
          platform=EXCLUDED.platform,architecture=EXCLUDED.architecture,timezone=EXCLUDED.timezone,
          local_time=EXCLUDED.local_time,ip_address=EXCLUDED.ip_address,local_ip=EXCLUDED.local_ip,
          public_ip=EXCLUDED.public_ip,network_state=EXCLUDED.network_state,server_latency_ms=EXCLUDED.server_latency_ms,
          cpu_percent=EXCLUDED.cpu_percent,ram_percent=EXCLUDED.ram_percent,ram_used_mb=EXCLUDED.ram_used_mb,
          ram_total_mb=EXCLUDED.ram_total_mb,process_memory_mb=EXCLUDED.process_memory_mb,
          disk_percent=EXCLUDED.disk_percent,disk_free_mb=EXCLUDED.disk_free_mb,disk_total_mb=EXCLUDED.disk_total_mb,
          cpu_temperature=EXCLUDED.cpu_temperature,uptime_seconds=EXCLUDED.uptime_seconds,
          screen_width_px=EXCLUDED.screen_width_px,screen_height_px=EXCLUDED.screen_height_px,
          screen_scale_factor=EXCLUDED.screen_scale_factor,current_playlist_id=EXCLUDED.current_playlist_id,
          current_playlist_name=EXCLUDED.current_playlist_name,current_media_id=EXCLUDED.current_media_id,
          current_media_name=EXCLUDED.current_media_name,current_zone=EXCLUDED.current_zone,
          playback_state=EXCLUDED.playback_state,media_position_seconds=EXCLUDED.media_position_seconds,
          media_remaining_seconds=EXCLUDED.media_remaining_seconds,eco_mode=EXCLUDED.eco_mode,
          last_sync_at=COALESCE(EXCLUDED.last_sync_at,cx_screen_telemetry.last_sync_at),last_error=EXCLUDED.last_error,
          cache_files=EXCLUDED.cache_files,cache_bytes=EXCLUDED.cache_bytes,download_state=EXCLUDED.download_state,
          download_current=EXCLUDED.download_current,download_total=EXCLUDED.download_total,
          heartbeat_sequence=EXCLUDED.heartbeat_sequence,boot_id=EXCLUDED.boot_id,last_heartbeat_at=NOW(),
          extra=EXCLUDED.extra,updated_at=NOW()`,[
          screen.id,b.player_version||null,b.os_version||null,b.hostname||null,b.platform||null,b.architecture||null,
          b.timezone||null,b.local_time||null,req.ip||b.ip_address||null,b.local_ip||null,b.public_ip||null,
          b.network_state||null,num(b.server_latency_ms,0,600000),num(b.cpu_percent,0,100),num(b.ram_percent,0,100),
          num(b.ram_used_mb,0),num(b.ram_total_mb,0),num(b.process_memory_mb,0),num(b.disk_percent,0,100),
          num(b.disk_free_mb,0),num(b.disk_total_mb,0),num(b.cpu_temperature,-100,250),num(b.uptime_seconds,0),
          num(b.screen_width_px,0),num(b.screen_height_px,0),num(b.screen_scale_factor,0.1,20),
          num(b.current_playlist_id,1),b.current_playlist_name||null,num(b.current_media_id,1),b.current_media_name||null,
          b.current_zone||null,b.playback_state||null,num(b.media_position_seconds,0),num(b.media_remaining_seconds,0),
          !!b.eco_mode,b.last_sync_at||null,b.last_error||null,num(b.cache_files,0),num(b.cache_bytes,0),
          b.download_state||null,num(b.download_current,0),num(b.download_total,0),num(b.heartbeat_sequence,0),
          b.boot_id||null,JSON.stringify(b.extra||{})]);
      await q('UPDATE cx_screens SET last_seen_at=NOW(),player_version=COALESCE($1,player_version) WHERE id=$2',[b.player_version||null,screen.id]);
      if(Number(b.heartbeat_sequence||0)%3===0){
        await q(`INSERT INTO cx_telemetry_samples(screen_id,cpu_percent,ram_percent,disk_percent,server_latency_ms,playback_state,current_media_id)
          VALUES($1,$2,$3,$4,$5,$6,$7)`,[screen.id,num(b.cpu_percent,0,100),num(b.ram_percent,0,100),num(b.disk_percent,0,100),num(b.server_latency_ms,0),b.playback_state||null,num(b.current_media_id,1)]);
      }
      const commands=(await q(`UPDATE cx_player_commands SET status='RECEIVED',received_at=COALESCE(received_at,NOW()) WHERE id IN
        (SELECT id FROM cx_player_commands WHERE screen_id=$1 AND status='PENDING' ORDER BY created_at LIMIT 20) RETURNING *`,[screen.id])).rows;
      res.json({ok:true,server_time:new Date().toISOString(),heartbeat_interval_seconds:20,sync_version:Number(screen.sync_version||0),commands,processing_ms:Date.now()-started});
    } catch(error){console.error('[V0.16 heartbeat]',error);res.status(500).json({error:error.message});}
  });

  app.get('/api/v33/monitoring/screens/:id/telemetry', auth, async(req,res)=>{
    try{
      const telemetry=(await q('SELECT * FROM cx_screen_telemetry WHERE screen_id=$1',[req.params.id])).rows[0]||null;
      const samples=(await q(`SELECT cpu_percent,ram_percent,disk_percent,server_latency_ms,playback_state,current_media_id,captured_at
        FROM cx_telemetry_samples WHERE screen_id=$1 AND captured_at>NOW()-INTERVAL '24 hours' ORDER BY captured_at`,[req.params.id])).rows;
      res.json({telemetry,samples});
    }catch(error){res.status(500).json({error:error.message});}
  });

  app.delete('/api/v33/telemetry/samples', auth, async(req,res)=>{
    try{const r=await q(`DELETE FROM cx_telemetry_samples WHERE captured_at<NOW()-INTERVAL '30 days' RETURNING id`);res.json({ok:true,deleted:r.rowCount});}
    catch(error){res.status(500).json({error:error.message});}
  });
}
module.exports={register};

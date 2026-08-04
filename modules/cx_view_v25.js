'use strict';

const crypto = require('crypto');

function register({ app, q, pool, auth, adminOnly, notifyPlayer }) {
  const cleanId = v => Number.isFinite(Number(v)) ? Number(v) : null;
  const safeText = (v, fallback='') => String(v ?? fallback).trim().slice(0, 500);
  const safeDate = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? String(v) : null;
  const safeTime = v => /^\d{2}:\d{2}(:\d{2})?$/.test(String(v || '')) ? String(v).slice(0,5) : null;
  const safeZone = v => ['A','B'].includes(v) ? v : 'A';
  const safeDays = v => {
    if (v === 'all') return 'all';
    const valid = [...new Set(String(v || '').split(',').filter(x => ['0','1','2','3','4','5','6'].includes(x)))];
    return valid.length === 7 ? 'all' : (valid.join(',') || 'all');
  };
  const safeColor = v => /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : '#6D5DFB';
  const safePriority = v => Math.max(0, Math.min(9999, Math.round(Number(v) || 100)));
  const safeTimezone = v => /^[A-Za-z_]+\/[A-Za-z0-9_+\-]+(?:\/[A-Za-z0-9_+\-]+)?$/.test(String(v||'')) ? String(v) : 'Europe/Brussels';
  const role = req => String(req.session?.userRole || '').toUpperCase();
  const isSuper = req => ['SUPER_ADMIN','SUPER'].includes(role(req));
  const tenantId = req => Number(req.session?.clientId) || null;
  const deny = res => res.status(403).json({error:'Accès refusé'});
  const safeTargetType = v => ['SCREEN','GROUP','MULTI','ALL'].includes(String(v||'').toUpperCase()) ? String(v).toUpperCase() : 'SCREEN';

  async function touchScreens(screenIds) {
    const ids=[...new Set((screenIds||[]).map(cleanId).filter(Boolean))];
    if(!ids.length) return;
    const r=await q(`UPDATE cx_screens SET sync_version=COALESCE(sync_version,0)+1
                     WHERE id=ANY($1::int[]) RETURNING id,pairing_code`,[ids]);
    for(const row of r.rows) notifyPlayer(row.pairing_code,{type:'sync',screenId:row.id});
  }

  async function resolveTargets(req, body) {
    const type=safeTargetType(body.target_type);
    let ids=[];
    if(type==='ALL') {
      ids=(await q(isSuper(req)?'SELECT id FROM cx_screens ORDER BY id':'SELECT id FROM cx_screens WHERE client_id=$1 ORDER BY id',isSuper(req)?[]:[tenantId(req)])).rows.map(x=>x.id);
    } else if(type==='GROUP') {
      const gid=cleanId(body.group_id);
      if(!gid) throw new Error('Groupe requis.');
      ids=(await q(isSuper(req)?'SELECT id FROM cx_screens WHERE group_id=$1 ORDER BY id':'SELECT id FROM cx_screens WHERE group_id=$1 AND client_id=$2 ORDER BY id',isSuper(req)?[gid]:[gid,tenantId(req)])).rows.map(x=>x.id);
    } else if(type==='MULTI') {
      ids=(Array.isArray(body.screen_ids)?body.screen_ids:[]).map(cleanId).filter(Boolean);
    } else {
      const id=cleanId(body.screen_id);
      if(id) ids=[id];
    }
    ids=[...new Set(ids)];
    if(!isSuper(req) && ids.length){ const allowed=(await q('SELECT id FROM cx_screens WHERE id=ANY($1::int[]) AND client_id=$2',[ids,tenantId(req)])).rows.map(x=>x.id); if(allowed.length!==ids.length) throw new Error('Un ou plusieurs écrans sont hors de votre espace client.'); ids=allowed; }
    if(!ids.length) throw new Error('Sélectionnez au moins un écran.');
    return {type,ids};
  }

  function campaignShape(rows) {
    if(!rows.length) return null;
    const first=rows[0];
    return {
      campaign_uid:first.campaign_uid || `legacy-${first.id}`,
      name:first.name,
      playlist_id:first.playlist_id,
      playlist_name:first.playlist_name,
      zone:first.zone,
      priority:first.priority,
      active:first.active,
      start_date:first.start_date,
      end_date:first.end_date,
      days:first.days,
      time_from:first.time_from,
      time_to:first.time_to,
      color:first.color,
      notes:first.notes,
      timezone:first.timezone,
      target_type:first.target_type || 'SCREEN',
      target_group_id:first.target_group_id,
      target_label:first.target_label,
      screens:rows.map(r=>({id:r.screen_id,name:r.screen_name,group_name:r.group_name,client_name:r.client_name,rule_id:r.id})),
      screen_count:rows.length,
      created_at:first.created_at,
      updated_at:first.updated_at
    };
  }

  app.get('/api/v25/scheduler/meta', auth, async (req, res) => {
    try {
      const cid=tenantId(req), scoped=!isSuper(req);
      if(scoped && !cid) return deny(res);
      const [screens, playlists, groups] = await Promise.all([
        q(`SELECT s.id,s.name,s.layout,s.group_id,c.name client_name,g.name group_name
           FROM cx_screens s LEFT JOIN cx_clients c ON c.id=s.client_id LEFT JOIN cx_screen_groups g ON g.id=s.group_id
           ${scoped?'WHERE s.client_id=$1':''} ORDER BY c.name NULLS FIRST,g.name NULLS FIRST,s.name`,scoped?[cid]:[]),
        q(`SELECT p.id,p.name,p.workspace_id,c.name client_name,COUNT(pi.id)::int item_count
           FROM cx_playlists p LEFT JOIN cx_clients c ON c.id=p.client_id LEFT JOIN cx_playlist_items pi ON pi.playlist_id=p.id
           ${scoped?'WHERE p.client_id=$1':''} GROUP BY p.id,c.name ORDER BY p.name`,scoped?[cid]:[]),
        q(`SELECT g.id,g.name,COUNT(s.id)::int screen_count
           FROM cx_screen_groups g LEFT JOIN cx_screens s ON s.group_id=g.id
           ${scoped?'WHERE g.client_id=$1':''} GROUP BY g.id ORDER BY g.name`,scoped?[cid]:[])
      ]);
      res.json({ screens:screens.rows, playlists:playlists.rows, groups:groups.rows });
    } catch (e) { console.error('[V0.14 scheduler meta]', e); res.status(500).json({ error:e.message }); }
  });

  app.get('/api/v25/scheduler/campaigns', auth, async (req,res)=>{
    try {
      const params=[];
      let sql=`SELECT r.*,s.name screen_name,c.name client_name,g.name group_name,p.name playlist_name
               FROM cx_screen_schedule_rules r
               JOIN cx_screens s ON s.id=r.screen_id
               JOIN cx_playlists p ON p.id=r.playlist_id
               LEFT JOIN cx_clients c ON c.id=s.client_id
               LEFT JOIN cx_screen_groups g ON g.id=s.group_id
               WHERE 1=1`;
      if(!isSuper(req)){if(!tenantId(req))return deny(res);params.push(tenantId(req));sql+=` AND s.client_id=$${params.length}`;}
      if(req.query.from){params.push(req.query.from);sql+=` AND (r.end_date IS NULL OR r.end_date >= $${params.length}::date)`;}
      if(req.query.to){params.push(req.query.to);sql+=` AND (r.start_date IS NULL OR r.start_date <= $${params.length}::date)`;}
      if(req.query.screen_id){params.push(Number(req.query.screen_id));sql+=` AND r.screen_id=$${params.length}`;}
      if(req.query.group_id){params.push(Number(req.query.group_id));sql+=` AND s.group_id=$${params.length}`;}
      sql+=' ORDER BY r.priority DESC,r.updated_at DESC,r.id DESC';
      const rows=(await q(sql,params)).rows;
      const groups=new Map();
      for(const row of rows){const key=row.campaign_uid||`legacy-${row.id}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row);}
      res.json([...groups.values()].map(campaignShape));
    } catch(e){console.error('[V0.14 campaigns]',e);res.status(500).json({error:e.message});}
  });

  app.post('/api/v25/scheduler/conflicts', auth, async (req,res)=>{
    try {
      const body=req.body;
      const target=await resolveTargets(req, body);
      const params=[target.ids,safeZone(body.zone),safeDate(body.start_date),safeDate(body.end_date),safeTime(body.time_from),safeTime(body.time_to),safeDays(body.days),safeText(body.exclude_uid)||null];
      const rows=(await q(`SELECT r.*,s.name screen_name,p.name playlist_name
        FROM cx_screen_schedule_rules r
        JOIN cx_screens s ON s.id=r.screen_id
        JOIN cx_playlists p ON p.id=r.playlist_id
        WHERE r.screen_id=ANY($1::int[]) AND r.zone=$2 AND r.active=true
          AND ($8::text IS NULL OR COALESCE(r.campaign_uid::text,'legacy-'||r.id::text)<>$8)
          AND (r.end_date IS NULL OR $3::date IS NULL OR r.end_date >= $3::date)
          AND ($4::date IS NULL OR r.start_date IS NULL OR r.start_date <= $4::date)
          AND (r.days='all' OR $7='all' OR EXISTS(
            SELECT 1 FROM unnest(string_to_array(r.days,',')) d WHERE d=ANY(string_to_array($7,','))))
          AND (r.time_from IS NULL OR r.time_to IS NULL OR $5::time IS NULL OR $6::time IS NULL OR
            (r.time_from < $6::time AND r.time_to > $5::time))
        ORDER BY r.priority DESC,r.id DESC`,params)).rows;
      res.json({conflicts:rows,count:rows.length,screen_count:new Set(rows.map(r=>r.screen_id)).size,blocking:rows.some(r=>Number(r.priority)===safePriority(body.priority))});
    } catch(e){res.status(400).json({error:e.message});}
  });

  app.post('/api/v25/scheduler/campaigns', adminOnly, async (req,res)=>{
    const client=await pool.connect();
    try {
      const b=req.body,target=await resolveTargets(req, b),playlistId=cleanId(b.playlist_id);
      if(!playlistId) throw new Error('Playlist requise.');
      if(!isSuper(req)){const own=await q('SELECT id FROM cx_playlists WHERE id=$1 AND client_id=$2',[playlistId,tenantId(req)]);if(!own.rows[0])throw new Error('Playlist inaccessible.');}
      const uid=crypto.randomUUID();
      const groupId=target.type==='GROUP'?cleanId(b.group_id):null;
      const label=safeText(b.target_label || (target.type==='ALL'?'Tous les écrans':''));
      await client.query('BEGIN');
      for(const screenId of target.ids){
        await client.query(`INSERT INTO cx_screen_schedule_rules
          (screen_id,zone,playlist_id,name,priority,active,start_date,end_date,days,time_from,time_to,color,notes,timezone,updated_at,campaign_uid,target_type,target_group_id,target_label)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),$15,$16,$17,$18)`,[
          screenId,safeZone(b.zone),playlistId,safeText(b.name,'Campagne')||'Campagne',safePriority(b.priority),b.active!==false,
          safeDate(b.start_date),safeDate(b.end_date),safeDays(b.days),safeTime(b.time_from),safeTime(b.time_to),safeColor(b.color),safeText(b.notes),safeTimezone(b.timezone),uid,target.type,groupId,label
        ]);
      }
      await client.query('COMMIT');
      await touchScreens(target.ids);
      res.status(201).json({ok:true,campaign_uid:uid,screen_count:target.ids.length});
    } catch(e){try{await client.query('ROLLBACK');}catch{} res.status(400).json({error:e.message});}
    finally{client.release();}
  });

  app.put('/api/v25/scheduler/campaigns/:uid', adminOnly, async (req,res)=>{
    const client=await pool.connect();
    try {
      const b=req.body,target=await resolveTargets(req, b),playlistId=cleanId(b.playlist_id),uid=req.params.uid;
      if(!playlistId) throw new Error('Playlist requise.');
      if(!isSuper(req)){const own=await q('SELECT id FROM cx_playlists WHERE id=$1 AND client_id=$2',[playlistId,tenantId(req)]);if(!own.rows[0])throw new Error('Playlist inaccessible.');}
      const old=(await client.query(`SELECT r.screen_id FROM cx_screen_schedule_rules r JOIN cx_screens s ON s.id=r.screen_id WHERE COALESCE(r.campaign_uid::text,'legacy-'||r.id::text)=$1${isSuper(req)?'':' AND s.client_id=$2'}`,isSuper(req)?[uid]:[uid,tenantId(req)])).rows.map(r=>r.screen_id);
      if(!old.length) throw new Error('Campagne introuvable.');
      const groupId=target.type==='GROUP'?cleanId(b.group_id):null;
      const label=safeText(b.target_label || (target.type==='ALL'?'Tous les écrans':''));
      await client.query('BEGIN');
      await client.query(`DELETE FROM cx_screen_schedule_rules r USING cx_screens s WHERE r.screen_id=s.id AND COALESCE(r.campaign_uid::text,'legacy-'||r.id::text)=$1${isSuper(req)?'':' AND s.client_id=$2'}`,isSuper(req)?[uid]:[uid,tenantId(req)]);
      const realUid=uid.startsWith('legacy-')?crypto.randomUUID():uid;
      for(const screenId of target.ids){
        await client.query(`INSERT INTO cx_screen_schedule_rules
          (screen_id,zone,playlist_id,name,priority,active,start_date,end_date,days,time_from,time_to,color,notes,timezone,updated_at,campaign_uid,target_type,target_group_id,target_label)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),$15,$16,$17,$18)`,[
          screenId,safeZone(b.zone),playlistId,safeText(b.name,'Campagne')||'Campagne',safePriority(b.priority),b.active!==false,
          safeDate(b.start_date),safeDate(b.end_date),safeDays(b.days),safeTime(b.time_from),safeTime(b.time_to),safeColor(b.color),safeText(b.notes),safeTimezone(b.timezone),realUid,target.type,groupId,label
        ]);
      }
      await client.query('COMMIT');
      await touchScreens([...old,...target.ids]);
      res.json({ok:true,campaign_uid:realUid,screen_count:target.ids.length});
    } catch(e){try{await client.query('ROLLBACK');}catch{} res.status(400).json({error:e.message});}
    finally{client.release();}
  });

  app.delete('/api/v25/scheduler/campaigns/:uid', adminOnly, async (req,res)=>{
    try{
      const r=await q(`DELETE FROM cx_screen_schedule_rules r USING cx_screens s WHERE r.screen_id=s.id AND COALESCE(r.campaign_uid::text,'legacy-'||r.id::text)=$1${isSuper(req)?'':' AND s.client_id=$2'} RETURNING r.screen_id`,isSuper(req)?[req.params.uid]:[req.params.uid,tenantId(req)]);
      if(!r.rowCount) return res.status(404).json({error:'Campagne introuvable.'});
      await touchScreens(r.rows.map(x=>x.screen_id));
      res.json({ok:true,screen_count:r.rowCount});
    }catch(e){res.status(500).json({error:e.message});}
  });

  app.post('/api/v25/scheduler/campaigns/:uid/duplicate', adminOnly, async (req,res)=>{
    try{
      const rows=(await q(`SELECT r.* FROM cx_screen_schedule_rules r JOIN cx_screens s ON s.id=r.screen_id WHERE COALESCE(r.campaign_uid::text,'legacy-'||r.id::text)=$1${isSuper(req)?'':' AND s.client_id=$2'} ORDER BY r.id`,isSuper(req)?[req.params.uid]:[req.params.uid,tenantId(req)])).rows;
      if(!rows.length) return res.status(404).json({error:'Campagne introuvable.'});
      const uid=crypto.randomUUID();
      for(const r of rows){await q(`INSERT INTO cx_screen_schedule_rules
        (screen_id,zone,playlist_id,name,priority,active,start_date,end_date,days,time_from,time_to,color,notes,timezone,updated_at,campaign_uid,target_type,target_group_id,target_label)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),$15,$16,$17,$18)`,[
        r.screen_id,r.zone,r.playlist_id,`${r.name} (copie)`,r.priority,r.active,r.start_date,r.end_date,r.days,r.time_from,r.time_to,r.color,r.notes,r.timezone,uid,r.target_type,r.target_group_id,r.target_label]);}
      await touchScreens(rows.map(r=>r.screen_id));
      res.status(201).json({ok:true,campaign_uid:uid});
    }catch(e){res.status(400).json({error:e.message});}
  });
}


module.exports={register};

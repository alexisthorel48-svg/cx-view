'use strict';

function register({ app, q, auth, adminOnly, notifyPlayer }) {
  const id = v => Number.isFinite(Number(v)) ? Number(v) : null;
  const text = (v, max=160) => String(v ?? '').trim().slice(0,max);
  const num = (v,min,max,fallback) => Math.max(min,Math.min(max,Number.isFinite(Number(v))?Number(v):fallback));
  const type = v => ['playlist','image','video','web','text','clock','rss','weather'].includes(String(v)) ? String(v) : 'playlist';

  async function touchScreens(sceneId){
    const r=await q(`UPDATE cx_screens s SET sync_version=COALESCE(sync_version,0)+1
                     FROM cx_screen_scenes ss WHERE ss.screen_id=s.id AND ss.scene_id=$1
                     RETURNING s.id,s.pairing_code`,[sceneId]);
    for(const row of r.rows) notifyPlayer(row.pairing_code,{type:'sync',screenId:row.id});
  }

  app.get('/api/v28/scenes/meta', auth, async (_req,res)=>{
    try{
      const [playlists,screens]=await Promise.all([
        q(`SELECT p.id,p.name,c.name client_name,COUNT(pi.id)::int item_count
           FROM cx_playlists p LEFT JOIN cx_clients c ON c.id=p.client_id
           LEFT JOIN cx_playlist_items pi ON pi.playlist_id=p.id
           GROUP BY p.id,c.name ORDER BY p.name`),
        q(`SELECT s.id,s.name,s.layout,c.name client_name FROM cx_screens s
           LEFT JOIN cx_clients c ON c.id=s.client_id ORDER BY s.name`)
      ]);
      res.json({playlists:playlists.rows,screens:screens.rows});
    }catch(e){console.error('[V0.6 scenes meta]',e);res.status(500).json({error:e.message});}
  });

  app.get('/api/v28/scenes', auth, async (_req,res)=>{
    try{
      const r=await q(`SELECT s.*,COUNT(z.id)::int zone_count,
        COALESCE(json_agg(json_build_object('screen_id',sc.screen_id,'screen_name',scr.name,'active',sc.active)
          ORDER BY scr.name) FILTER (WHERE sc.screen_id IS NOT NULL),'[]') assignments
        FROM cx_scenes s
        LEFT JOIN cx_scene_zones z ON z.scene_id=s.id
        LEFT JOIN cx_screen_scenes sc ON sc.scene_id=s.id
        LEFT JOIN cx_screens scr ON scr.id=sc.screen_id
        GROUP BY s.id ORDER BY s.updated_at DESC,s.id DESC`);
      res.json(r.rows);
    }catch(e){console.error('[V0.6 scenes list]',e);res.status(500).json({error:e.message});}
  });

  app.get('/api/v28/scenes/:id', auth, async (req,res)=>{
    try{
      const scene=(await q('SELECT * FROM cx_scenes WHERE id=$1',[req.params.id])).rows[0];
      if(!scene)return res.status(404).json({error:'Scène introuvable.'});
      const [zones,assignments]=await Promise.all([
        q(`SELECT z.*,p.name playlist_name FROM cx_scene_zones z
           LEFT JOIN cx_playlists p ON p.id=z.playlist_id WHERE z.scene_id=$1 ORDER BY z.layer,z.id`,[scene.id]),
        q(`SELECT ss.*,s.name screen_name FROM cx_screen_scenes ss JOIN cx_screens s ON s.id=ss.screen_id
           WHERE ss.scene_id=$1 ORDER BY s.name`,[scene.id])
      ]);
      res.json({...scene,zones:zones.rows,assignments:assignments.rows});
    }catch(e){console.error('[V0.6 scene detail]',e);res.status(500).json({error:e.message});}
  });

  app.post('/api/v28/scenes', adminOnly, async (req,res)=>{
    try{
      const b=req.body||{};
      const r=await q(`INSERT INTO cx_scenes(name,description,width,height,background,active,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW()) RETURNING *`,[
        text(b.name)||'Nouvelle scène',text(b.description,500),Math.round(num(b.width,320,7680,1920)),
        Math.round(num(b.height,240,4320,1080)),/^#[0-9a-f]{6}$/i.test(b.background||'')?b.background:'#000000',b.active!==false
      ]);
      res.status(201).json(r.rows[0]);
    }catch(e){console.error('[V0.6 scene create]',e);res.status(400).json({error:e.message});}
  });

  app.put('/api/v28/scenes/:id', adminOnly, async (req,res)=>{
    try{
      const b=req.body||{};
      const r=await q(`UPDATE cx_scenes SET name=$1,description=$2,width=$3,height=$4,background=$5,active=$6,updated_at=NOW()
        WHERE id=$7 RETURNING *`,[text(b.name)||'Scène',text(b.description,500),Math.round(num(b.width,320,7680,1920)),
        Math.round(num(b.height,240,4320,1080)),/^#[0-9a-f]{6}$/i.test(b.background||'')?b.background:'#000000',b.active!==false,req.params.id]);
      if(!r.rows[0])return res.status(404).json({error:'Scène introuvable.'});
      await touchScreens(req.params.id);res.json(r.rows[0]);
    }catch(e){console.error('[V0.6 scene update]',e);res.status(400).json({error:e.message});}
  });

  app.delete('/api/v28/scenes/:id', adminOnly, async (req,res)=>{
    try{await touchScreens(req.params.id);const r=await q('DELETE FROM cx_scenes WHERE id=$1 RETURNING id',[req.params.id]);
      if(!r.rows[0])return res.status(404).json({error:'Scène introuvable.'});res.json({ok:true});
    }catch(e){console.error('[V0.6 scene delete]',e);res.status(500).json({error:e.message});}
  });

  app.post('/api/v28/scenes/:id/zones', adminOnly, async (req,res)=>{
    try{
      const b=req.body||{};
      const r=await q(`INSERT INTO cx_scene_zones(scene_id,name,content_type,playlist_id,content_value,x,y,width,height,layer,muted,fit,created_at,updated_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),NOW()) RETURNING *`,[
        req.params.id,text(b.name)||'Zone',type(b.content_type),id(b.playlist_id),text(b.content_value,2000),
        num(b.x,0,100,5),num(b.y,0,100,5),num(b.width,1,100,40),num(b.height,1,100,40),Math.round(num(b.layer,0,999,0)),b.muted!==false,
        ['stretch','contain','cover'].includes(b.fit)?b.fit:'contain'
      ]);await touchScreens(req.params.id);res.status(201).json(r.rows[0]);
    }catch(e){console.error('[V0.6 zone create]',e);res.status(400).json({error:e.message});}
  });

  app.put('/api/v28/scenes/:sceneId/zones/:zoneId', adminOnly, async (req,res)=>{
    try{
      const b=req.body||{};
      const r=await q(`UPDATE cx_scene_zones SET name=$1,content_type=$2,playlist_id=$3,content_value=$4,
        x=$5,y=$6,width=$7,height=$8,layer=$9,muted=$10,fit=$11,updated_at=NOW()
        WHERE id=$12 AND scene_id=$13 RETURNING *`,[text(b.name)||'Zone',type(b.content_type),id(b.playlist_id),text(b.content_value,2000),
        num(b.x,0,100,0),num(b.y,0,100,0),num(b.width,1,100,25),num(b.height,1,100,25),Math.round(num(b.layer,0,999,0)),b.muted!==false,
        ['stretch','contain','cover'].includes(b.fit)?b.fit:'contain',req.params.zoneId,req.params.sceneId]);
      if(!r.rows[0])return res.status(404).json({error:'Zone introuvable.'});await touchScreens(req.params.sceneId);res.json(r.rows[0]);
    }catch(e){console.error('[V0.6 zone update]',e);res.status(400).json({error:e.message});}
  });

  app.delete('/api/v28/scenes/:sceneId/zones/:zoneId', adminOnly, async (req,res)=>{
    try{const r=await q('DELETE FROM cx_scene_zones WHERE id=$1 AND scene_id=$2 RETURNING id',[req.params.zoneId,req.params.sceneId]);
      if(!r.rows[0])return res.status(404).json({error:'Zone introuvable.'});await touchScreens(req.params.sceneId);res.json({ok:true});
    }catch(e){console.error('[V0.6 zone delete]',e);res.status(500).json({error:e.message});}
  });

  app.put('/api/v28/scenes/:id/assignments', adminOnly, async (req,res)=>{
    const client=await q('BEGIN').then(()=>true).catch(()=>false);
    try{
      const screenIds=Array.isArray(req.body.screen_ids)?req.body.screen_ids.map(id).filter(Boolean):[];
      await q('DELETE FROM cx_screen_scenes WHERE scene_id=$1',[req.params.id]);
      for(const screenId of screenIds) await q(`INSERT INTO cx_screen_scenes(screen_id,scene_id,active,updated_at)
        VALUES($1,$2,true,NOW()) ON CONFLICT(screen_id) DO UPDATE SET scene_id=EXCLUDED.scene_id,active=true,updated_at=NOW()`,[screenId,req.params.id]);
      await q('COMMIT');await touchScreens(req.params.id);res.json({ok:true,count:screenIds.length});
    }catch(e){if(client)try{await q('ROLLBACK')}catch(_){ }console.error('[V0.6 assignments]',e);res.status(400).json({error:e.message});}
  });

  app.get('/api/player/:code/scene', async (req,res)=>{
    try{
      const code=String(req.params.code||'').trim().toUpperCase();
      const r=await q(`SELECT sc.* FROM cx_screens s JOIN cx_screen_scenes ss ON ss.screen_id=s.id AND ss.active=true
        JOIN cx_scenes sc ON sc.id=ss.scene_id AND sc.active=true WHERE s.pairing_code=$1 LIMIT 1`,[code]);
      if(!r.rows[0])return res.json({scene:null});
      const zones=await q(`SELECT id,name,content_type,playlist_id,content_value,x,y,width,height,layer,muted,fit
        FROM cx_scene_zones WHERE scene_id=$1 ORDER BY layer,id`,[r.rows[0].id]);
      res.json({scene:{...r.rows[0],zones:zones.rows}});
    }catch(e){console.error('[V0.6 player scene]',e);res.status(500).json({error:e.message});}
  });
}
module.exports={register};

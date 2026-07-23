
const fs=require('fs'), path=require('path'), crypto=require('crypto'), multer=require('multer');

function brusselsNow(){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Brussels',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'}).formatToParts(new Date());
  const v=t=>parts.find(x=>x.type===t)?.value;
  return {date:`${v('year')}-${v('month')}-${v('day')}`,time:`${v('hour')}:${v('minute')}`,day:({Mon:'mon',Tue:'tue',Wed:'wed',Thu:'thu',Fri:'fri',Sat:'sat',Sun:'sun'})[v('weekday')]};
}
function ruleMatches(r){
  const n=brusselsNow();
  if(!r.active || (r.start_date && String(r.start_date).slice(0,10)>n.date) || (r.end_date && String(r.end_date).slice(0,10)<n.date)) return false;
  if(r.days && r.days!=='all' && !r.days.split(',').includes(n.day)) return false;
  if(r.time_from && r.time_to){ const a=String(r.time_from).slice(0,5), b=String(r.time_to).slice(0,5); return a<=b ? n.time>=a&&n.time<b : n.time>=a||n.time<b; }
  return true;
}
function scoped(req, base, field='client_id'){
  if(req.session?.userRole==='CLIENT'){ base.params.push(req.session.clientId); base.sql+=` AND ${field}=$${base.params.length}`; }
  return base;
}
module.exports.register=({app,q,auth,adminOnly,superOnly,notifyPlayer,notifyScreens,PUBLIC_BASE_URL,MEDIA_ROOT})=>{
  const upload=multer({storage:multer.diskStorage({destination:(r,f,cb)=>cb(null,path.join(MEDIA_ROOT,'uploads')),filename:(r,f,cb)=>cb(null,crypto.randomUUID()+path.extname(f.originalname).toLowerCase())}),limits:{fileSize:500*1024*1024}});

  // Real hierarchical folders and secure media access.
  app.get('/api/v3/folders',auth,async(req,res)=>{try{
    let b={sql:`SELECT f.*,c.name client_name FROM cx_folders f LEFT JOIN cx_clients c ON c.id=f.client_id WHERE 1=1`,params:[]};
    scoped(req,b,'f.client_id'); b.sql+=' ORDER BY COALESCE(f.path,f.name),f.name'; res.json((await q(b.sql,b.params)).rows);
  }catch(e){res.status(500).json({error:e.message})}});
  app.post('/api/v3/folders',adminOnly,async(req,res)=>{try{
    const name=String(req.body.name||'').trim(); if(!name)return res.status(400).json({error:'Nom requis'});
    const parent=req.body.parent_id?await q('SELECT path,client_id FROM cx_folders WHERE id=$1',[req.body.parent_id]):null;
    if(req.body.parent_id&&!parent.rows[0])return res.status(404).json({error:'Dossier parent introuvable'});
    const clientId=req.body.client_id||parent?.rows[0]?.client_id||null, parentPath=parent?.rows[0]?.path||'';
    const r=await q('INSERT INTO cx_folders(name,client_id,parent_id,path) VALUES($1,$2,$3,$4) RETURNING *',[name,clientId,req.body.parent_id||null,parentPath?`${parentPath}/${name}`:name]);res.json(r.rows[0]);
  }catch(e){res.status(500).json({error:e.message})}});
  app.get('/api/v3/media',auth,async(req,res)=>{try{
    let b={sql:`SELECT m.*,c.name client_name,f.name folder_name,f.path folder_path FROM cx_media m LEFT JOIN cx_clients c ON c.id=m.client_id LEFT JOIN cx_folders f ON f.id=m.folder_id WHERE m.status<>'PENDING_DELETE'`,params:[]};
    scoped(req,b,'m.client_id');
    if(req.query.folder_id){b.params.push(req.query.folder_id);b.sql+=` AND m.folder_id=$${b.params.length}`;}
    if(req.query.search){b.params.push('%'+req.query.search+'%');b.sql+=` AND m.title ILIKE $${b.params.length}`;}
    b.sql+=' ORDER BY m.created_at DESC';res.json((await q(b.sql,b.params)).rows);
  }catch(e){res.status(500).json({error:e.message})}});
  app.post('/api/v3/media/upload',adminOnly,upload.array('files',100),async(req,res)=>{try{
    const result=[]; for(const f of req.files||[]){const isVideo=f.mimetype.startsWith('video/');const r=await q(`INSERT INTO cx_media(client_id,folder_id,title,file_name,original_name,mime_type,media_type,bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[req.body.client_id||null,req.body.folder_id||null,path.parse(f.originalname).name,f.filename,f.originalname,f.mimetype,isVideo?'VIDEO':'IMAGE',f.size]);result.push(r.rows[0]);}res.json(result);
  }catch(e){res.status(500).json({error:e.message})}});

  // Screen groups, bulk grouping, crop and scheduled playlist overrides.
  app.get('/api/v3/groups',auth,async(req,res)=>{try{let b={sql:`SELECT g.*,COUNT(s.id)::int screen_count FROM cx_screen_groups g LEFT JOIN cx_screens s ON s.group_id=g.id WHERE 1=1`,params:[]};scoped(req,b,'g.client_id');b.sql+=' GROUP BY g.id ORDER BY g.name';res.json((await q(b.sql,b.params)).rows)}catch(e){res.status(500).json({error:e.message})}});
  app.post('/api/v3/groups',adminOnly,async(req,res)=>{try{const r=await q('INSERT INTO cx_screen_groups(name,client_id) VALUES($1,$2) RETURNING *',[req.body.name,req.body.client_id||null]);res.json(r.rows[0])}catch(e){res.status(500).json({error:e.message})}});
  app.get('/api/v3/screens',auth,async(req,res)=>{try{
    let b={sql:`SELECT s.*,c.name client_name,g.name group_name,pa.name playlist_a_name,pb.name playlist_b_name FROM cx_screens s LEFT JOIN cx_clients c ON c.id=s.client_id LEFT JOIN cx_screen_groups g ON g.id=s.group_id LEFT JOIN cx_playlists pa ON pa.id=s.playlist_a_id LEFT JOIN cx_playlists pb ON pb.id=s.playlist_b_id WHERE 1=1`,params:[]};scoped(req,b,'s.client_id');
    if(req.query.search){b.params.push('%'+req.query.search+'%');b.sql+=` AND s.name ILIKE $${b.params.length}`;} if(req.query.group_id){b.params.push(req.query.group_id);b.sql+=` AND s.group_id=$${b.params.length}`;}
    b.sql+=' ORDER BY s.name';res.json((await q(b.sql,b.params)).rows);
  }catch(e){res.status(500).json({error:e.message})}});
  app.put('/api/v3/screens/:id/layout',adminOnly,async(req,res)=>{try{
    const b=req.body, r=await q(`UPDATE cx_screens SET group_id=$1,crop_top=$2,crop_right=$3,crop_bottom=$4,crop_left=$5,sync_version=COALESCE(sync_version,0)+1 WHERE id=$6 RETURNING *`,[b.group_id||null,Math.max(0,+b.crop_top||0),Math.max(0,+b.crop_right||0),Math.max(0,+b.crop_bottom||0),Math.max(0,+b.crop_left||0),req.params.id]);
    if(!r.rows[0])return res.status(404).json({error:'Écran introuvable'});notifyPlayer(r.rows[0].pairing_code,{type:'sync'});res.json(r.rows[0]);
  }catch(e){res.status(500).json({error:e.message})}});
  app.post('/api/v3/screens/bulk-group',adminOnly,async(req,res)=>{try{
    const ids=(req.body.ids||[]).map(Number).filter(Boolean);if(!ids.length)return res.status(400).json({error:'Aucun écran sélectionné'});
    await q('UPDATE cx_screens SET group_id=$1,sync_version=COALESCE(sync_version,0)+1 WHERE id=ANY($2::int[])',[req.body.group_id||null,ids]);const r=await q('SELECT pairing_code FROM cx_screens WHERE id=ANY($1::int[])',[ids]);notifyScreens(r.rows);res.json({ok:true,count:ids.length});
  }catch(e){res.status(500).json({error:e.message})}});
  app.get('/api/v3/screens/:id/rules',auth,async(req,res)=>{try{res.json((await q(`SELECT r.*,p.name playlist_name FROM cx_screen_schedule_rules r JOIN cx_playlists p ON p.id=r.playlist_id WHERE r.screen_id=$1 ORDER BY r.zone,r.priority DESC,r.id DESC`,[req.params.id])).rows)}catch(e){res.status(500).json({error:e.message})}});
  app.post('/api/v3/screens/:id/rules',adminOnly,async(req,res)=>{try{
    const b=req.body,r=await q(`INSERT INTO cx_screen_schedule_rules(screen_id,zone,playlist_id,name,priority,active,start_date,end_date,days,time_from,time_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[req.params.id,b.zone||'A',b.playlist_id,b.name||null,+b.priority||100,b.active!==false,b.start_date||null,b.end_date||null,b.days||'all',b.time_from||null,b.time_to||null]);
    const s=await q('UPDATE cx_screens SET sync_version=COALESCE(sync_version,0)+1 WHERE id=$1 RETURNING pairing_code',[req.params.id]);notifyPlayer(s.rows[0]?.pairing_code,{type:'sync'});res.json(r.rows[0]);
  }catch(e){res.status(500).json({error:e.message})}});
  app.delete('/api/v3/rules/:id',adminOnly,async(req,res)=>{try{await q('DELETE FROM cx_screen_schedule_rules WHERE id=$1',[req.params.id]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});

  // Slide records, QR action sessions, external triggers, proof-of-play and remote captures.
  app.get('/api/v3/slides',auth,async(req,res)=>{try{let b={sql:'SELECT * FROM cx_slide_templates WHERE 1=1',params:[]};scoped(req,b);b.sql+=' ORDER BY updated_at DESC';res.json((await q(b.sql,b.params)).rows)}catch(e){res.status(500).json({error:e.message})}});
  app.post('/api/v3/slides',adminOnly,async(req,res)=>{try{const r=await q('INSERT INTO cx_slide_templates(name,client_id,canvas) VALUES($1,$2,$3) RETURNING *',[req.body.name,req.body.client_id||null,JSON.stringify(req.body.canvas||{})]);res.json(r.rows[0])}catch(e){res.status(500).json({error:e.message})}});
  app.post('/api/v3/qr/session',adminOnly,async(req,res)=>{try{const token=crypto.randomUUID().replaceAll('-','');await q('INSERT INTO cx_qr_sessions(token,screen_id,playlist_id,expires_at) VALUES($1,$2,$3,NOW()+INTERVAL \'15 minutes\')',[token,req.body.screen_id,req.body.playlist_id||null]);const origin=PUBLIC_BASE_URL||`${req.protocol}://${req.get('host')}`;res.json({token,url:`${origin}/api/v3/qr/${token}`})}catch(e){res.status(500).json({error:e.message})}});
  app.get('/api/v3/qr/:token',async(req,res)=>{const r=await q('SELECT * FROM cx_qr_sessions WHERE token=$1 AND expires_at>NOW()',[req.params.token]);if(!r.rows[0])return res.status(410).send('Session QR expirée');res.type('html').send(`<meta name="viewport" content="width=device-width"><body style="font-family:system-ui;padding:24px"><h2>CX‑View</h2><p>Choisissez un média à envoyer à l’écran.</p><form method="post" action="/api/v3/qr/${req.params.token}/select"><input name="media_id" placeholder="ID média"><button>Envoyer</button></form></body>`)});
  app.post('/api/v3/qr/:token/select',async(req,res)=>{try{const z=await q('SELECT * FROM cx_qr_sessions WHERE token=$1 AND expires_at>NOW()',[req.params.token]);if(!z.rows[0])return res.status(410).json({error:'Session expirée'});const s=await q('SELECT pairing_code FROM cx_screens WHERE id=$1',[z.rows[0].screen_id]);notifyPlayer(s.rows[0]?.pairing_code,{type:'qr-select',mediaId:req.body.media_id||null});res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
  app.post('/api/v3/triggers',adminOnly,async(req,res)=>{try{const r=await q('INSERT INTO cx_api_triggers(screen_id,label,widget_config,duration_seconds) VALUES($1,$2,$3,$4) RETURNING *',[req.body.screen_id,req.body.label,JSON.stringify(req.body.widget_config||{}),+req.body.duration_seconds||30]);res.json(r.rows[0])}catch(e){res.status(500).json({error:e.message})}});
  app.post('/api/v3/public/trigger/:token',async(req,res)=>{try{const r=await q('SELECT t.*,s.pairing_code FROM cx_api_triggers t JOIN cx_screens s ON s.id=t.screen_id WHERE t.token=$1 AND t.active=true',[req.params.token]);if(!r.rows[0])return res.status(404).json({error:'Déclencheur introuvable'});notifyPlayer(r.rows[0].pairing_code,{type:'priority-trigger',payload:r.rows[0]});res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
  app.post('/api/v3/screens/:id/capture',adminOnly,async(req,res)=>{const s=await q('SELECT pairing_code FROM cx_screens WHERE id=$1',[req.params.id]);if(!s.rows[0])return res.status(404).json({error:'Écran introuvable'});notifyPlayer(s.rows[0].pairing_code,{type:'capture-request'});res.json({ok:true})});
  app.post('/api/v3/player/:code/capture',async(req,res)=>{try{const s=await q('SELECT id FROM cx_screens WHERE pairing_code=$1',[String(req.params.code).toUpperCase()]);if(!s.rows[0])return res.status(404).end();await q('INSERT INTO cx_screen_captures(screen_id,image_data) VALUES($1,$2)',[s.rows[0].id,req.body.image_data]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
  app.get('/api/v3/reports/proof-of-play.csv',auth,async(req,res)=>{try{let b={sql:`SELECT l.played_at,s.name screen,m.title media,l.zone FROM cx_logs l LEFT JOIN cx_screens s ON s.id=l.screen_id LEFT JOIN cx_media m ON m.id=l.media_id WHERE 1=1`,params:[]};scoped(req,b,'s.client_id');b.sql+=' ORDER BY l.played_at DESC LIMIT 10000';const r=await q(b.sql,b.params);res.attachment('cx-view-proof-of-play.csv').type('text/csv').send('date;ecran;media;zone\n'+r.rows.map(x=>[x.played_at,x.screen,x.media,x.zone].map(v=>`"${String(v||'').replaceAll('"','""')}"`).join(';')).join('\n'))}catch(e){res.status(500).json({error:e.message})}});

  // Player V3 endpoint. V7 uses it; legacy V6 remains untouched.
  app.get('/api/v3/player/:code',async(req,res)=>{try{
    const screen=(await q('SELECT * FROM cx_screens WHERE pairing_code=$1',[String(req.params.code).trim().toUpperCase()])).rows[0];if(!screen)return res.status(404).json({error:'Code introuvable'});
    await q('UPDATE cx_screens SET last_seen_at=NOW(),player_version=COALESCE($1,player_version) WHERE id=$2',[req.get('X-CX-View-Version')||null,screen.id]);
    const rules=(await q('SELECT * FROM cx_screen_schedule_rules WHERE screen_id=$1 AND active=true ORDER BY priority DESC,id DESC',[screen.id])).rows.filter(ruleMatches);
    const selectRule=z=>rules.find(r=>r.zone===z);
    const items=async playlistId=>{if(!playlistId)return[];return (await q(`SELECT pi.*,m.file_name,m.title,m.mime_type,m.media_type,m.thumbnail_name FROM cx_playlist_items pi LEFT JOIN cx_media m ON m.id=pi.media_id WHERE pi.playlist_id=$1 AND pi.active=true ORDER BY pi.position`,[playlistId])).rows.map(i=>({...i,url:i.file_name?`${PUBLIC_BASE_URL}/files/uploads/${i.file_name}`:null}))};
    const ra=selectRule('A'),rb=selectRule('B');res.json({screen:{id:screen.id,name:screen.name,width:screen.width_px,height:screen.height_px,orientation:screen.orientation,layout:screen.layout,display_mode:screen.display_mode||'WINDOW',monitor_id:+screen.monitor_id||0,sync_version:+screen.sync_version||0,crop_top:+screen.crop_top||0,crop_right:+screen.crop_right||0,crop_bottom:+screen.crop_bottom||0,crop_left:+screen.crop_left||0},zones:{A:await items(ra?.playlist_id||screen.playlist_a_id),B:screen.layout!=='SINGLE'?await items(rb?.playlist_id||screen.playlist_b_id):[]}});
  }catch(e){res.status(500).json({error:e.message})}});
};

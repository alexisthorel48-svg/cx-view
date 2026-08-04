'use strict';
const fs=require('fs'); const path=require('path'); const crypto=require('crypto'); const multer=require('multer');
function sha256File(fp){return new Promise((resolve,reject)=>{const h=crypto.createHash('sha256');const s=fs.createReadStream(fp);s.on('data',d=>h.update(d));s.on('end',()=>resolve(h.digest('hex')));s.on('error',reject);});}
function register({app,q,superOnly,MEDIA_ROOT,PUBLIC_BASE_URL,notifyPlayer}){
 const root=path.join(MEDIA_ROOT,'player-updates'); fs.mkdirSync(root,{recursive:true});
 const upload=multer({dest:path.join(root,'incoming'),limits:{fileSize:1024*1024*1024}});
 const clean=v=>String(v||'').trim(); const tokenHash=t=>crypto.createHash('sha256').update(String(t||'')).digest('hex'); const bearer=req=>{const h=String(req.headers.authorization||'');return h.startsWith('Bearer ')?h.slice(7).trim():''}; const channel=v=>['STABLE','BETA','DEV'].includes(String(v||'').toUpperCase())?String(v).toUpperCase():'STABLE';
 const baseUrl=req=>PUBLIC_BASE_URL||`${req.protocol}://${req.get('host')}`;
 async function release(id){return (await q('SELECT * FROM cx_player_releases WHERE id=$1',[id])).rows[0]||null;}
 async function screensFor(targetType,targetId){
   if(targetType==='ALL') return (await q('SELECT id,name,pairing_code,player_version,update_channel FROM cx_screens ORDER BY name')).rows;
   if(targetType==='SCREEN') return (await q('SELECT id,name,pairing_code,player_version,update_channel FROM cx_screens WHERE id=$1',[targetId])).rows;
   if(targetType==='GROUP') return (await q('SELECT id,name,pairing_code,player_version,update_channel FROM cx_screens WHERE group_id=$1 ORDER BY name',[targetId])).rows;
   return [];
 }
 async function queueUpdate(screen,rel,userId,deploymentId,req){
   const packageUrl=`${baseUrl(req)}/api/player/${encodeURIComponent(screen.pairing_code)}/update-package/${rel.id}`;
   const payload={release_id:rel.id,deployment_id:deploymentId,version:rel.version,channel:rel.channel,package_url:packageUrl,sha256:rel.sha256,bytes:Number(rel.bytes||0),file_name:rel.original_name||rel.file_name,mandatory:!!rel.mandatory};
   const cmd=(await q(`INSERT INTO cx_player_commands(screen_id,type,payload,status,requested_by,source_type,source_id)
      VALUES($1,'UPDATE_PLAYER',$2::jsonb,'PENDING',$3,'PLAYER_DEPLOYMENT',$4) RETURNING *`,[screen.id,JSON.stringify(payload),userId,deploymentId])).rows[0];
   await q(`INSERT INTO cx_player_deployment_targets(deployment_id,screen_id,command_id,status,from_version,to_version)
      VALUES($1,$2,$3,'PENDING',$4,$5) ON CONFLICT(deployment_id,screen_id) DO UPDATE SET command_id=EXCLUDED.command_id,status='PENDING',from_version=EXCLUDED.from_version,to_version=EXCLUDED.to_version,error_message=NULL,progress=0`,[deploymentId,screen.id,cmd.id,screen.player_version||null,rel.version]);
   await q(`UPDATE cx_screens SET update_status='PENDING',update_progress=0,update_target_version=$1,update_last_error=NULL WHERE id=$2`,[rel.version,screen.id]);
   notifyPlayer(screen.pairing_code,{type:'command',commandId:cmd.id,command:'UPDATE_PLAYER'}); return cmd;
 }
 app.get('/api/v34/releases',superOnly,async(req,res)=>{try{res.json((await q(`SELECT r.*,u.display_name created_by_name,
   COUNT(DISTINCT t.screen_id)::int target_count,COUNT(DISTINCT t.screen_id) FILTER(WHERE t.status='COMPLETED')::int success_count
   FROM cx_player_releases r LEFT JOIN cx_users u ON u.id=r.created_by LEFT JOIN cx_player_deployments d ON d.release_id=r.id LEFT JOIN cx_player_deployment_targets t ON t.deployment_id=d.id
   GROUP BY r.id,u.display_name ORDER BY r.created_at DESC`)).rows)}catch(e){res.status(500).json({error:e.message})}});
 app.post('/api/v34/releases',superOnly,upload.single('package'),async(req,res)=>{let temp=req.file?.path;try{
   if(!req.file)return res.status(400).json({error:'Package requis'}); const version=clean(req.body.version); if(!/^\d+\.\d+\.\d+([.-][0-9A-Za-z.-]+)?$/.test(version))return res.status(400).json({error:'Version invalide (ex. 1.2.0)'});
   const ext=path.extname(req.file.originalname||'').toLowerCase(); if(!['.exe','.zip','.tar','.gz'].includes(ext))return res.status(400).json({error:'Format accepté : .exe, .zip, .tar ou .gz'});
   const sha=await sha256File(temp); const stored=`player-${version}-${sha.slice(0,12)}${ext}`; fs.renameSync(temp,path.join(root,stored)); temp=null;
   const r=(await q(`INSERT INTO cx_player_releases(version,channel,status,file_name,original_name,mime_type,bytes,sha256,release_notes,mandatory,created_by)
     VALUES($1,$2,'DRAFT',$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,[version,channel(req.body.channel),stored,req.file.originalname,req.file.mimetype,req.file.size,sha,clean(req.body.release_notes)||null,String(req.body.mandatory)==='true',req.session.userId])).rows[0]; res.status(201).json(r);
 }catch(e){res.status(400).json({error:e.message})}finally{if(temp)fs.rmSync(temp,{force:true})}});
 
 app.get('/api/v34/releases/:id/download',superOnly,async(req,res)=>{try{
 const r=(await q('SELECT * FROM cx_player_releases WHERE id=$1',[req.params.id])).rows[0];
 if(!r)return res.sendStatus(404);
 const f=path.join(root,r.file_name);
 if(!fs.existsSync(f))return res.sendStatus(404);
 res.download(f,r.original_name||r.file_name);
 }catch(e){res.status(500).json({error:e.message})}});
 app.get('/api/player/latest',superOnly,async(req,res)=>{try{
 const r=(await q(`SELECT id,version,channel,bytes,sha256,published_at,original_name,file_name FROM cx_player_releases WHERE status='PUBLISHED' ORDER BY CASE WHEN channel='STABLE' THEN 0 ELSE 1 END,published_at DESC,created_at DESC LIMIT 1`)).rows[0];
 if(!r)return res.status(404).json({error:'Aucune version Player publiée'});
 res.json({...r,download:'/api/player/latest/download'});
}catch(e){res.status(500).json({error:e.message})}});
app.get('/api/player/latest/download',superOnly,async(req,res)=>{try{
 const r=(await q(`SELECT * FROM cx_player_releases WHERE status='PUBLISHED' ORDER BY CASE WHEN channel='STABLE' THEN 0 ELSE 1 END,published_at DESC,created_at DESC LIMIT 1`)).rows[0];
 if(!r)return res.status(404).json({error:'Aucune version Player publiée'});
 const f=path.join(root,path.basename(r.file_name));if(!fs.existsSync(f))return res.status(404).json({error:'Package introuvable'});
 res.setHeader('X-CX-Player-Version',r.version);res.setHeader('X-CX-SHA256',r.sha256);res.download(f,r.original_name||r.file_name);
}catch(e){res.status(500).json({error:e.message})}});
 app.delete('/api/v34/releases/:id',superOnly,async(req,res)=>{try{
 const r=(await q('SELECT * FROM cx_player_releases WHERE id=$1',[req.params.id])).rows[0];
 if(!r)return res.sendStatus(404);
 if(r.status!=='ARCHIVED')return res.status(400).json({error:'Archive requise'});
 await q('DELETE FROM cx_player_deployment_targets WHERE deployment_id IN (SELECT id FROM cx_player_deployments WHERE release_id=$1)',[r.id]);
 await q('DELETE FROM cx_player_deployments WHERE release_id=$1',[r.id]);
 await q('DELETE FROM cx_player_releases WHERE id=$1',[r.id]);
 try{fs.rmSync(path.join(root,r.file_name),{force:true})}catch{}
 res.json({ok:true});
 }catch(e){res.status(500).json({error:e.message})}});
app.post('/api/v34/releases/:id/publish',superOnly,async(req,res)=>{try{const r=(await q(`UPDATE cx_player_releases SET status='PUBLISHED',published_at=COALESCE(published_at,NOW()) WHERE id=$1 RETURNING *`,[req.params.id])).rows[0];if(!r)return res.status(404).json({error:'Version introuvable'});res.json(r)}catch(e){res.status(500).json({error:e.message})}});
 app.post('/api/v34/releases/:id/archive',superOnly,async(req,res)=>{try{res.json((await q(`UPDATE cx_player_releases SET status='ARCHIVED',archived_at=NOW() WHERE id=$1 RETURNING *`,[req.params.id])).rows[0]||{})}catch(e){res.status(500).json({error:e.message})}});
 app.get('/api/player/:code/update-package/:id',async(req,res)=>{try{const code=String(req.params.code||'').trim().toUpperCase();const screen=(await q('SELECT id,player_token_hash FROM cx_screens WHERE pairing_code=$1',[code])).rows[0];if(!screen||!screen.player_token_hash||tokenHash(bearer(req))!==screen.player_token_hash)return res.status(401).json({error:'Jeton player invalide'});const r=await release(req.params.id);if(!r||r.status!=='PUBLISHED')return res.status(404).end();const fp=path.join(root,path.basename(r.file_name));if(!fs.existsSync(fp))return res.status(404).end();res.setHeader('Content-Disposition',`attachment; filename="${String(r.original_name||r.file_name).replace(/"/g,'')}"`);res.setHeader('X-CX-Player-Version',r.version);res.setHeader('X-CX-SHA256',r.sha256);res.sendFile(fp)}catch(e){res.status(500).json({error:e.message})}});
 app.get('/api/v34/targets',superOnly,async(req,res)=>{try{const [screens,groups]=await Promise.all([q(`SELECT id,name,player_version,update_channel,update_status,update_progress,update_target_version,last_seen_at FROM cx_screens ORDER BY name`),q(`SELECT id,name FROM cx_screen_groups ORDER BY name`)]);res.json({screens:screens.rows,groups:groups.rows})}catch(e){res.status(500).json({error:e.message})}});
 app.post('/api/v34/deployments',superOnly,async(req,res)=>{try{const rel=await release(req.body.release_id);if(!rel||rel.status!=='PUBLISHED')return res.status(400).json({error:'La version doit être publiée'});const targetType=String(req.body.target_type||'').toUpperCase();if(!['ALL','GROUP','SCREEN'].includes(targetType))return res.status(400).json({error:'Cible invalide'});const targetId=targetType==='ALL'?null:Number(req.body.target_id);const screens=await screensFor(targetType,targetId);if(!screens.length)return res.status(400).json({error:'Aucun écran ciblé'});
   const dep=(await q(`INSERT INTO cx_player_deployments(release_id,target_type,target_id,status,rollout_mode,scheduled_at,created_by,started_at)
     VALUES($1,$2,$3,'RUNNING',$4,$5,$6,NOW()) RETURNING *`,[rel.id,targetType,targetId,clean(req.body.rollout_mode)||'IMMEDIATE',req.body.scheduled_at||null,req.session.userId])).rows[0];
   for(const s of screens)await queueUpdate(s,rel,req.session.userId,dep.id,req);res.status(201).json({...dep,target_count:screens.length});
 }catch(e){res.status(500).json({error:e.message})}});
 app.get('/api/v34/deployments',superOnly,async(req,res)=>{try{res.json((await q(`SELECT d.*,r.version,r.channel,r.sha256,
   COUNT(t.id)::int target_count,COUNT(t.id) FILTER(WHERE t.status='COMPLETED')::int completed_count,COUNT(t.id) FILTER(WHERE t.status='FAILED')::int failed_count,COUNT(t.id) FILTER(WHERE t.status IN('PENDING','RECEIVED','RUNNING'))::int active_count
   FROM cx_player_deployments d JOIN cx_player_releases r ON r.id=d.release_id LEFT JOIN cx_player_deployment_targets t ON t.deployment_id=d.id GROUP BY d.id,r.id ORDER BY d.created_at DESC LIMIT 100`)).rows)}catch(e){res.status(500).json({error:e.message})}});
 app.get('/api/v34/deployments/:id',superOnly,async(req,res)=>{try{const d=(await q(`SELECT d.*,r.version,r.channel,r.sha256 FROM cx_player_deployments d JOIN cx_player_releases r ON r.id=d.release_id WHERE d.id=$1`,[req.params.id])).rows[0];if(!d)return res.status(404).json({error:'Déploiement introuvable'});const targets=(await q(`SELECT t.*,s.name screen_name,s.pairing_code,s.player_version,s.last_seen_at FROM cx_player_deployment_targets t JOIN cx_screens s ON s.id=t.screen_id WHERE t.deployment_id=$1 ORDER BY s.name`,[req.params.id])).rows;res.json({deployment:d,targets})}catch(e){res.status(500).json({error:e.message})}});
 app.post('/api/v34/deployments/:id/cancel',superOnly,async(req,res)=>{try{await q(`UPDATE cx_player_deployments SET status='CANCELLED',completed_at=NOW() WHERE id=$1`,[req.params.id]);await q(`UPDATE cx_player_commands SET status='FAILED',error_message='Déploiement annulé',completed_at=NOW() WHERE source_type='PLAYER_DEPLOYMENT' AND source_id=$1 AND status IN('PENDING','RECEIVED')`,[req.params.id]);await q(`UPDATE cx_player_deployment_targets SET status='CANCELLED',completed_at=NOW() WHERE deployment_id=$1 AND status IN('PENDING','RECEIVED')`,[req.params.id]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
 app.post('/api/player/:code/update-progress',async(req,res)=>{try{const code=String(req.params.code||'').toUpperCase();const s=(await q('SELECT id,player_token_hash FROM cx_screens WHERE pairing_code=$1',[code])).rows[0];if(!s)return res.status(404).json({error:'Écran introuvable'});const status=String(req.body.status||'RUNNING').toUpperCase();const progress=Math.max(0,Math.min(100,Number(req.body.progress||0)));const dep=Number(req.body.deployment_id||0);await q(`UPDATE cx_screens SET update_status=$1,update_progress=$2,update_target_version=COALESCE($3,update_target_version),update_last_error=$4 WHERE id=$5`,[status,progress,req.body.version||null,req.body.error||null,s.id]);if(dep)await q(`UPDATE cx_player_deployment_targets SET status=$1,progress=$2,error_message=$3,started_at=CASE WHEN $1='RUNNING' THEN COALESCE(started_at,NOW()) ELSE started_at END,completed_at=CASE WHEN $1 IN('COMPLETED','FAILED','ROLLED_BACK') THEN NOW() ELSE completed_at END WHERE deployment_id=$4 AND screen_id=$5`,[status,progress,req.body.error||null,dep,s.id]);if(status==='COMPLETED')await q(`UPDATE cx_screens SET player_version=COALESCE($1,player_version),update_status='COMPLETED',update_progress=100 WHERE id=$2`,[req.body.version||null,s.id]);res.json({ok:true})}catch(e){res.status(500).json({error:e.message})}});
}
module.exports={register};

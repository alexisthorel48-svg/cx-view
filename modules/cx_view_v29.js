function register({app,q,auth,notifyPlayer}){
 const role=req=>String(req.session?.userRole||'').toUpperCase();
 const clientId=req=>req.session?.clientId||null;
 const isSuper=req=>role(req)==='SUPER_ADMIN';
 const canManage=req=>isSuper(req)||role(req)==='ADMIN';
 const deny=(res,msg='Accès refusé')=>res.status(403).json({error:msg});
 const safe=s=>String(s||'').trim().slice(0,180);
 const scope=(req,alias='s')=>isSuper(req)?{sql:'',params:[]}:{sql:` AND ${alias}.client_id=$1`,params:[clientId(req)]};
 const log=(label,e)=>console.error(`[V0.7.3] ${label}:`,e);

 app.get('/api/v29/context',auth,(req,res)=>res.json({role:role(req),client_id:clientId(req),super_admin:isSuper(req),can_manage:canManage(req),can_delete_screen:isSuper(req),can_create_screen:isSuper(req)}));

 app.get('/api/v29/clients',auth,async(req,res)=>{try{
   const p=[];let where='';if(!isSuper(req)){p.push(clientId(req));where='WHERE c.id=$1'}
   const r=await q(`SELECT c.id,c.name,c.contact_email,c.active,c.created_at,
     COUNT(DISTINCT s.id)::int screen_count,COUNT(DISTINCT u.id)::int user_count,
     COUNT(DISTINCT st.id)::int site_count,COUNT(DISTINCT g.id)::int group_count
     FROM cx_clients c
     LEFT JOIN cx_screens s ON s.client_id=c.id
     LEFT JOIN cx_users u ON u.client_id=c.id
     LEFT JOIN cx_sites st ON st.client_id=c.id AND st.active=true
     LEFT JOIN cx_screen_groups g ON g.client_id=c.id AND g.active=true
     ${where} GROUP BY c.id ORDER BY c.name`,p);res.json(r.rows)
 }catch(e){log('clients list',e);res.status(500).json({error:e.message})}});

 app.post('/api/v29/clients',auth,async(req,res)=>{try{
   if(!isSuper(req))return deny(res,'Réservé au Super Admin');
   const name=safe(req.body.name);if(!name)return res.status(400).json({error:'Nom du client requis'});
   const r=await q('INSERT INTO cx_clients(name,contact_email,active) VALUES($1,$2,$3) RETURNING *',[name,req.body.contact_email||null,req.body.active!==false]);res.status(201).json(r.rows[0]);
 }catch(e){log('client create',e);res.status(400).json({error:e.code==='23505'?'Un client porte déjà ce nom.':e.message})}});

 app.put('/api/v29/clients/:id',auth,async(req,res)=>{try{
   if(!isSuper(req))return deny(res,'Réservé au Super Admin');
   const name=safe(req.body.name);if(!name)return res.status(400).json({error:'Nom du client requis'});
   const r=await q('UPDATE cx_clients SET name=$1,contact_email=$2,active=$3 WHERE id=$4 RETURNING *',[name,req.body.contact_email||null,req.body.active!==false,req.params.id]);
   if(!r.rows[0])return res.status(404).json({error:'Client introuvable'});res.json(r.rows[0]);
 }catch(e){log('client update',e);res.status(400).json({error:e.code==='23505'?'Un client porte déjà ce nom.':e.message})}});

 app.delete('/api/v29/clients/:id',auth,async(req,res)=>{try{
   if(!isSuper(req))return deny(res,'Réservé au Super Admin');
   const id=Number(req.params.id);if(!id)return res.status(400).json({error:'Client invalide'});
   const exists=await q('SELECT id,name FROM cx_clients WHERE id=$1',[id]);
   if(!exists.rows[0])return res.status(404).json({error:'Client introuvable'});
   // Une suppression demandée est définitive : les contenus et écrans sont conservés,
   // mais deviennent internes. Les comptes utilisateurs propres au client sont supprimés.
   const cols=await q(`SELECT table_name,is_nullable FROM information_schema.columns
     WHERE table_schema='public' AND column_name='client_id' AND table_name <> 'cx_clients'`);
   const detached={};
   for(const row of cols.rows){
     const table=String(row.table_name);
     if(!/^cx_[a-z0-9_]+$/.test(table))continue;
     if(table==='cx_users')continue;
     if(row.is_nullable!=='YES')continue;
     const r=await q(`UPDATE ${table} SET client_id=NULL WHERE client_id=$1`,[id]);
     if(r.rowCount)detached[table]=r.rowCount;
   }
   const users=await q('DELETE FROM cx_users WHERE client_id=$1 RETURNING id',[id]);
   const r=await q('DELETE FROM cx_clients WHERE id=$1 RETURNING id',[id]);
   if(!r.rows[0])return res.status(404).json({error:'Client introuvable'});
   res.json({ok:true,detached,deleted_users:users.rowCount});
 }catch(e){log('client delete',e);res.status(500).json({error:e.message})}});

 app.get('/api/v29/sites',auth,async(req,res)=>{try{
   const p=[];let where=' WHERE COALESCE(x.active,true)=true';
   if(!isSuper(req)){p.push(clientId(req));where+=` AND (x.client_id=$${p.length} OR x.client_id IS NULL)`}
   const r=await q(`SELECT x.*,c.name client_name,COUNT(sc.id)::int screen_count
     FROM cx_sites x LEFT JOIN cx_clients c ON c.id=x.client_id LEFT JOIN cx_screens sc ON sc.site_id=x.id
     ${where} GROUP BY x.id,c.name ORDER BY (x.client_id IS NOT NULL),c.name NULLS FIRST,x.name`,p);res.json(r.rows)
 }catch(e){log('sites list',e);res.status(500).json({error:e.message})}});
 app.post('/api/v29/sites',auth,async(req,res)=>{try{
   if(!canManage(req))return deny(res);const cid=isSuper(req)?(req.body.client_id||null):clientId(req);
   const name=safe(req.body.name);if(!name)return res.status(400).json({error:'Nom requis'});
   const r=await q('INSERT INTO cx_sites(client_id,name,address,city,active) VALUES($1,$2,$3,$4,true) RETURNING *',[cid,name,req.body.address||null,req.body.city||null]);res.status(201).json(r.rows[0])
 }catch(e){log('site create',e);res.status(400).json({error:e.code==='23505'?'Un site porte déjà ce nom dans cet espace.':e.message})}});
 app.put('/api/v29/sites/:id',auth,async(req,res)=>{try{
   if(!canManage(req))return deny(res);const cid=isSuper(req)?(req.body.client_id||null):clientId(req);
   const p=[safe(req.body.name),req.body.address||null,req.body.city||null,cid,req.params.id];
   let sql='UPDATE cx_sites SET name=$1,address=$2,city=$3,client_id=$4 WHERE id=$5';
   if(!isSuper(req)){p.push(clientId(req));sql+=' AND client_id=$6'}sql+=' RETURNING *';
   const r=await q(sql,p);if(!r.rows[0])return res.status(404).json({error:'Site introuvable'});res.json(r.rows[0])
 }catch(e){log('site update',e);res.status(400).json({error:e.message})}});
 app.delete('/api/v29/sites/:id',auth,async(req,res)=>{try{
   if(!canManage(req))return deny(res);
   const ownP=[req.params.id];let ownSql='SELECT id,name FROM cx_sites WHERE id=$1';
   if(!isSuper(req)){ownP.push(clientId(req));ownSql+=' AND client_id=$2'}
   const own=await q(ownSql,ownP);if(!own.rows[0])return res.status(404).json({error:'Site introuvable ou non modifiable.'});
   const detached=await q('UPDATE cx_screens SET site_id=NULL WHERE site_id=$1 RETURNING id',[req.params.id]);
   const removed=await q('DELETE FROM cx_sites WHERE id=$1 RETURNING id',[req.params.id]);
   if(!removed.rows[0])return res.status(404).json({error:'Site introuvable.'});
   res.json({ok:true,detached_screens:detached.rowCount})
 }catch(e){log('site delete',e);res.status(500).json({error:e.message})}});

 app.get('/api/v29/groups',auth,async(req,res)=>{try{
   const p=[];let where=' WHERE COALESCE(g.active,true)=true';
   if(!isSuper(req)){p.push(clientId(req));where+=` AND (g.client_id=$${p.length} OR g.client_id IS NULL)`}
   const r=await q(`SELECT g.*,c.name client_name,COUNT(sc.id)::int screen_count
     FROM cx_screen_groups g LEFT JOIN cx_clients c ON c.id=g.client_id LEFT JOIN cx_screens sc ON sc.group_id=g.id
     ${where} GROUP BY g.id,c.name ORDER BY (g.client_id IS NOT NULL),c.name NULLS FIRST,g.name`,p);res.json(r.rows)
 }catch(e){log('groups list',e);res.status(500).json({error:e.message})}});
 app.post('/api/v29/groups',auth,async(req,res)=>{try{
   if(!canManage(req))return deny(res);const cid=isSuper(req)?(req.body.client_id||null):clientId(req);
   const name=safe(req.body.name);if(!name)return res.status(400).json({error:'Nom requis'});
   const r=await q('INSERT INTO cx_screen_groups(client_id,name,description,active) VALUES($1,$2,$3,true) RETURNING *',[cid,name,req.body.description||null]);res.status(201).json(r.rows[0])
 }catch(e){log('group create',e);res.status(400).json({error:e.code==='23505'?'Un groupe porte déjà ce nom dans cet espace.':e.message})}});
 app.put('/api/v29/groups/:id',auth,async(req,res)=>{try{
   if(!canManage(req))return deny(res);const cid=isSuper(req)?(req.body.client_id||null):clientId(req);
   const p=[safe(req.body.name),req.body.description||null,cid,req.params.id];let sql='UPDATE cx_screen_groups SET name=$1,description=$2,client_id=$3 WHERE id=$4';
   if(!isSuper(req)){p.push(clientId(req));sql+=' AND client_id=$5'}sql+=' RETURNING *';
   const r=await q(sql,p);if(!r.rows[0])return res.status(404).json({error:'Groupe introuvable'});res.json(r.rows[0])
 }catch(e){log('group update',e);res.status(400).json({error:e.message})}});
 app.delete('/api/v29/groups/:id',auth,async(req,res)=>{try{
   if(!canManage(req))return deny(res);
   const ownP=[req.params.id];let ownSql='SELECT id,name FROM cx_screen_groups WHERE id=$1';
   if(!isSuper(req)){ownP.push(clientId(req));ownSql+=' AND client_id=$2'}
   const own=await q(ownSql,ownP);if(!own.rows[0])return res.status(404).json({error:'Groupe introuvable ou non modifiable.'});
   const detached=await q('UPDATE cx_screens SET group_id=NULL WHERE group_id=$1 RETURNING id',[req.params.id]);
   const removed=await q('DELETE FROM cx_screen_groups WHERE id=$1 RETURNING id',[req.params.id]);
   if(!removed.rows[0])return res.status(404).json({error:'Groupe introuvable.'});
   res.json({ok:true,detached_screens:detached.rowCount})
 }catch(e){log('group delete',e);res.status(500).json({error:e.message})}});

 app.get('/api/v29/screens',auth,async(req,res)=>{try{let p=[],where=' WHERE 1=1';if(!isSuper(req)){p.push(clientId(req));where+=` AND s.client_id=$${p.length}`};if(req.query.client_id&&isSuper(req)){p.push(req.query.client_id);where+=` AND s.client_id=$${p.length}`};if(req.query.site_id){p.push(req.query.site_id);where+=` AND s.site_id=$${p.length}`};if(req.query.group_id){p.push(req.query.group_id);where+=` AND s.group_id=$${p.length}`};if(req.query.status==='online')where+=` AND s.last_seen_at>NOW()-INTERVAL '5 minutes'`;if(req.query.status==='offline')where+=` AND (s.last_seen_at IS NULL OR s.last_seen_at<=NOW()-INTERVAL '5 minutes')`;if(req.query.search){p.push('%'+req.query.search+'%');where+=` AND (s.name ILIKE $${p.length} OR s.pairing_code ILIKE $${p.length} OR COALESCE(s.location_label,'') ILIKE $${p.length} OR COALESCE(c.name,'') ILIKE $${p.length} OR COALESCE(g.name,'') ILIKE $${p.length})`};const r=await q(`SELECT s.*,c.name client_name,st.name site_name,g.name group_name,pa.name playlist_a_name,pb.name playlist_b_name,(s.last_seen_at>NOW()-INTERVAL '5 minutes') online FROM cx_screens s LEFT JOIN cx_clients c ON c.id=s.client_id LEFT JOIN cx_sites st ON st.id=s.site_id LEFT JOIN cx_screen_groups g ON g.id=s.group_id LEFT JOIN cx_playlists pa ON pa.id=s.playlist_a_id LEFT JOIN cx_playlists pb ON pb.id=s.playlist_b_id${where} ORDER BY COALESCE(c.name,''),COALESCE(st.name,''),s.name`,p);res.json(r.rows)}catch(e){log('screens list',e);res.status(500).json({error:e.message})}});
 app.get('/api/v29/screens/:id',auth,async(req,res)=>{try{const p=[req.params.id];let sql=`SELECT s.*,c.name client_name,st.name site_name,g.name group_name,pa.name playlist_a_name,pb.name playlist_b_name,(s.last_seen_at>NOW()-INTERVAL '5 minutes') online FROM cx_screens s LEFT JOIN cx_clients c ON c.id=s.client_id LEFT JOIN cx_sites st ON st.id=s.site_id LEFT JOIN cx_screen_groups g ON g.id=s.group_id LEFT JOIN cx_playlists pa ON pa.id=s.playlist_a_id LEFT JOIN cx_playlists pb ON pb.id=s.playlist_b_id WHERE s.id=$1`;if(!isSuper(req)){p.push(clientId(req));sql+=' AND s.client_id=$2'}const r=await q(sql,p);if(!r.rows[0])return res.status(404).json({error:'Écran introuvable'});res.json(r.rows[0])}catch(e){log('screen detail',e);res.status(500).json({error:e.message})}});
 app.delete('/api/v29/screens/:id',auth,async(req,res)=>{try{
   if(!isSuper(req))return deny(res,'Réservé au Super Admin');
   const p=[req.params.id];let sql='DELETE FROM cx_screens WHERE id=$1';
   if(!isSuper(req)){p.push(clientId(req));sql+=' AND client_id=$2'}
   sql+=' RETURNING id,name,pairing_code';
   const r=await q(sql,p);
   if(!r.rows[0])return res.status(404).json({error:'Écran introuvable ou non modifiable.'});
   res.json({ok:true,screen:r.rows[0]});
 }catch(e){log('screen delete',e);res.status(500).json({error:e.message})}});
 app.put('/api/v29/screens/:id/organization',auth,async(req,res)=>{try{if(!canManage(req))return deny(res);const b=req.body;const targetClient=isSuper(req)?(b.client_id||null):clientId(req);if(b.site_id){const x=await q('SELECT client_id FROM cx_sites WHERE id=$1',[b.site_id]);if(!x.rows[0]||(x.rows[0].client_id!==null&&Number(x.rows[0].client_id)!==Number(targetClient)))return res.status(400).json({error:'Le site ne correspond pas à cet écran.'})}if(b.group_id){const x=await q('SELECT client_id FROM cx_screen_groups WHERE id=$1',[b.group_id]);if(!x.rows[0]||(x.rows[0].client_id!==null&&Number(x.rows[0].client_id)!==Number(targetClient)))return res.status(400).json({error:'Le groupe ne correspond pas à cet écran.'})}const p=[targetClient,b.site_id||null,b.group_id||null,b.location_label||null,b.screen_type||'FIXED',req.params.id];let sql=`UPDATE cx_screens SET client_id=$1,site_id=$2,group_id=$3,location_label=$4,screen_type=$5,sync_version=COALESCE(sync_version,0)+1 WHERE id=$6`;if(!isSuper(req)){p.push(clientId(req));sql+=' AND client_id=$7'}sql+=' RETURNING *';const r=await q(sql,p);if(!r.rows[0])return res.status(404).json({error:'Écran introuvable'});notifyPlayer(r.rows[0].pairing_code,{type:'sync'});res.json(r.rows[0])}catch(e){log('screen organization',e);res.status(400).json({error:e.message})}});
 app.post('/api/v29/screens/bulk-group',auth,async(req,res)=>{try{if(!canManage(req))return deny(res);const ids=(req.body.ids||[]).map(Number).filter(Boolean);if(!ids.length)return res.status(400).json({error:'Aucun écran sélectionné'});const gid=req.body.group_id||null;if(gid){const gr=await q('SELECT client_id FROM cx_screen_groups WHERE id=$1',[gid]);if(!gr.rows[0])return res.status(404).json({error:'Groupe introuvable'});if(!isSuper(req)&&gr.rows[0].client_id!==null&&Number(gr.rows[0].client_id)!==Number(clientId(req)))return deny(res)}const p=[gid,ids];let sql='UPDATE cx_screens SET group_id=$1,sync_version=COALESCE(sync_version,0)+1 WHERE id=ANY($2::int[])';if(!isSuper(req)){p.push(clientId(req));sql+=' AND client_id=$3'}const r=await q(sql+' RETURNING pairing_code',p);for(const x of r.rows)notifyPlayer(x.pairing_code,{type:'sync'});res.json({ok:true,count:r.rowCount})}catch(e){log('bulk group',e);res.status(400).json({error:e.message})}});

 app.get('/api/v29/users',auth,async(req,res)=>{try{if(!canManage(req))return deny(res);const p=[];let where='';if(!isSuper(req)){p.push(clientId(req));where=' WHERE u.client_id=$1'}const r=await q(`SELECT u.id,u.email,u.display_name,u.role,u.client_id,u.active,u.created_at,c.name client_name,COUNT(DISTINCT s.id)::int screen_count FROM cx_users u LEFT JOIN cx_clients c ON c.id=u.client_id LEFT JOIN cx_screens s ON s.client_id=u.client_id${where} GROUP BY u.id,c.name ORDER BY c.name NULLS FIRST,u.display_name`,p);res.json(r.rows)}catch(e){log('users list',e);res.status(500).json({error:e.message})}});
 app.post('/api/v29/users',auth,async(req,res)=>{try{if(!canManage(req))return deny(res);const bcrypt=require('bcryptjs');const cid=isSuper(req)?(req.body.client_id||null):clientId(req);let r=String(req.body.role||'VIEWER').toUpperCase();if(!isSuper(req)&&!['ADMIN','EDITOR','VIEWER'].includes(r))r='VIEWER';if(!req.body.password)return res.status(400).json({error:'Mot de passe requis'});if(r!=='SUPER_ADMIN'&&!cid)return res.status(400).json({error:'Client requis pour ce rôle'});const hash=await bcrypt.hash(req.body.password,12);const z=await q('INSERT INTO cx_users(email,password_hash,display_name,role,client_id,active) VALUES($1,$2,$3,$4,$5,true) RETURNING id,email,display_name,role,client_id,active',[req.body.email,hash,req.body.display_name||req.body.email,r,r==='SUPER_ADMIN'?null:cid]);res.status(201).json(z.rows[0])}catch(e){log('user create',e);res.status(400).json({error:e.message})}});
 app.put('/api/v29/users/:id',auth,async(req,res)=>{try{if(!canManage(req))return deny(res);const bcrypt=require('bcryptjs');const cid=isSuper(req)?(req.body.client_id||null):clientId(req);let r=String(req.body.role||'VIEWER').toUpperCase();if(!isSuper(req)&&!['ADMIN','EDITOR','VIEWER'].includes(r))r='VIEWER';if(r!=='SUPER_ADMIN'&&!cid)return res.status(400).json({error:'Client requis pour ce rôle'});const p=[req.body.email,req.body.display_name,r,r==='SUPER_ADMIN'?null:cid,req.body.active!==false,req.params.id];let sql='UPDATE cx_users SET email=$1,display_name=$2,role=$3,client_id=$4,active=$5 WHERE id=$6';if(!isSuper(req)){p.push(clientId(req));sql+=' AND client_id=$7'}sql+=' RETURNING id,email,display_name,role,client_id,active';const z=await q(sql,p);if(!z.rows[0])return res.status(404).json({error:'Utilisateur introuvable'});if(req.body.password){const hash=await bcrypt.hash(req.body.password,12);await q('UPDATE cx_users SET password_hash=$1 WHERE id=$2',[hash,req.params.id])}res.json(z.rows[0])}catch(e){log('user update',e);res.status(400).json({error:e.message})}});
 app.delete('/api/v29/users/:id',auth,async(req,res)=>{try{if(!canManage(req))return deny(res);if(Number(req.params.id)===Number(req.session.userId))return res.status(400).json({error:'Impossible de supprimer votre propre compte.'});const p=[req.params.id];let sql='DELETE FROM cx_users WHERE id=$1';if(!isSuper(req)){p.push(clientId(req));sql+=' AND client_id=$2'}sql+=' RETURNING id';const r=await q(sql,p);if(!r.rows[0])return res.status(404).json({error:'Utilisateur introuvable'});res.json({ok:true})}catch(e){log('user delete',e);res.status(500).json({error:e.message})}});
}
module.exports={register};

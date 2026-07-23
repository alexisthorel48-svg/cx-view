const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');

function brusselsNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23', weekday:'short'
  }).formatToParts(new Date()).reduce((o, p) => (o[p.type] = p.value, o), {});
  const map = {Sun:'sun', Mon:'mon', Tue:'tue', Wed:'wed', Thu:'thu', Fri:'fri', Sat:'sat'};
  return { date:`${parts.year}-${parts.month}-${parts.day}`, time:`${parts.hour}:${parts.minute}`, day:map[parts.weekday] };
}
function scope(req, clientId) {
  return req.session && req.session.userRole === 'CLIENT' ? Number(req.session.clientId) === Number(clientId) : true;
}
function assertClientScope(req, res, clientId) {
  if (!scope(req, clientId)) { res.status(403).json({error:'Accès refusé'}); return false; }
  return true;
}
function isRuleActive(rule) {
  if (!rule.active) return false;
  const now = brusselsNow();
  if (rule.start_date && String(rule.start_date).slice(0,10) > now.date) return false;
  if (rule.end_date && String(rule.end_date).slice(0,10) < now.date) return false;
  if (rule.days && rule.days !== 'all' && !String(rule.days).split(',').includes(now.day)) return false;
  if (rule.time_from && rule.time_to) {
    const a=String(rule.time_from).slice(0,5), b=String(rule.time_to).slice(0,5);
    return a <= b ? now.time >= a && now.time < b : (now.time >= a || now.time < b);
  }
  return true;
}

module.exports = {
  register({app, q, auth, adminOnly, superOnly, notifyPlayer, notifyScreens, MEDIA_ROOT, PUBLIC_BASE_URL}) {
    const uploads = path.join(MEDIA_ROOT, 'uploads');
    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => { fs.mkdirSync(uploads, {recursive:true}); cb(null, uploads); },
      filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase())
    });
    const upload = multer({storage, limits:{fileSize:500*1024*1024}});

    async function folderById(id) {
      if (!id) return null;
      const r = await q('SELECT * FROM cx_folders WHERE id=$1', [id]);
      return r.rows[0] || null;
    }
    async function ensureFolder(name, clientId, parentId) {
      const existing = await q(
        'SELECT * FROM cx_folders WHERE name=$1 AND client_id IS NOT DISTINCT FROM $2 AND parent_id IS NOT DISTINCT FROM $3 LIMIT 1',
        [name, clientId || null, parentId || null]
      );
      if (existing.rows[0]) return existing.rows[0];
      const parent = await folderById(parentId);
      const created = await q(
        'INSERT INTO cx_folders(name,client_id,parent_id,path) VALUES($1,$2,$3,$4) RETURNING *',
        [name, clientId || null, parentId || null, parent ? `${parent.path || parent.name}/${name}` : name]
      );
      return created.rows[0];
    }
    async function ensurePath(parts, clientId, parentId) {
      let parent = parentId || null;
      for (const raw of parts) {
        const name = String(raw || '').trim();
        if (!name) continue;
        const folder = await ensureFolder(name, clientId, parent);
        parent = folder.id;
      }
      return parent;
    }
    function mediaScope(req, params, base='m') {
      if (req.session && req.session.userRole === 'CLIENT') {
        params.push(req.session.clientId);
        return ` AND ${base}.client_id=$${params.length}`;
      }
      return '';
    }

    // Finder media API
    app.get('/api/v4/folders', auth, async (req,res) => {
      try {
        const params=[];
        let sql=`SELECT f.*, c.name client_name,
          (SELECT COUNT(*)::int FROM cx_folders child WHERE child.parent_id=f.id) child_count,
          (SELECT COUNT(*)::int FROM cx_media m WHERE m.folder_id=f.id AND m.status <> 'PENDING_DELETE') media_count
          FROM cx_folders f LEFT JOIN cx_clients c ON c.id=f.client_id WHERE 1=1`;
        if (req.session.userRole === 'CLIENT') { params.push(req.session.clientId); sql+=` AND f.client_id=$${params.length}`; }
        sql+=' ORDER BY COALESCE(f.path,f.name), f.name';
        res.json((await q(sql,params)).rows);
      } catch(e){res.status(500).json({error:e.message});}
    });
    app.post('/api/v4/folders', adminOnly, async (req,res) => {
      try {
        const name=String(req.body.name||'').trim();
        if(!name) return res.status(400).json({error:'Nom du dossier requis'});
        const parent=await folderById(req.body.parent_id||null);
        const clientId = parent ? parent.client_id : (req.body.client_id||null);
        const folder=await ensureFolder(name, clientId, parent ? parent.id : null);
        res.status(201).json(folder);
      } catch(e){res.status(500).json({error:e.message});}
    });
    app.put('/api/v4/folders/:id', adminOnly, async (req,res) => {
      try {
        const current=await folderById(req.params.id); if(!current)return res.status(404).json({error:'Dossier introuvable'});
        const name=String(req.body.name||current.name).trim();
        const parentId=req.body.parent_id === undefined ? current.parent_id : (req.body.parent_id||null);
        if (Number(parentId)===Number(current.id)) return res.status(400).json({error:'Un dossier ne peut pas être son propre parent'});
        const parent=await folderById(parentId);
        const clientId=parent ? parent.client_id : (req.body.client_id===undefined?current.client_id:(req.body.client_id||null));
        const nextPath=parent ? `${parent.path||parent.name}/${name}` : name;
        const r=await q('UPDATE cx_folders SET name=$1,parent_id=$2,client_id=$3,path=$4 WHERE id=$5 RETURNING *',[name,parentId,clientId,nextPath,current.id]);
        res.json(r.rows[0]);
      } catch(e){res.status(500).json({error:e.message});}
    });
    app.delete('/api/v4/folders/:id', adminOnly, async (req,res) => {
      try {
        const hasChildren=await q('SELECT 1 FROM cx_folders WHERE parent_id=$1 LIMIT 1',[req.params.id]);
        const hasMedia=await q("SELECT 1 FROM cx_media WHERE folder_id=$1 AND status <> 'PENDING_DELETE' LIMIT 1",[req.params.id]);
        if(hasChildren.rows[0]||hasMedia.rows[0]) return res.status(409).json({error:'Déplacez d’abord les sous-dossiers et médias.'});
        await q('DELETE FROM cx_folders WHERE id=$1',[req.params.id]);res.json({ok:true});
      }catch(e){res.status(500).json({error:e.message});}
    });
    app.get('/api/v4/media', auth, async (req,res) => {
      try {
        const params=[];
        let sql=`SELECT m.*,c.name client_name,f.name folder_name,f.path folder_path
          FROM cx_media m LEFT JOIN cx_clients c ON c.id=m.client_id LEFT JOIN cx_folders f ON f.id=m.folder_id
          WHERE m.status <> 'PENDING_DELETE'`;
        sql+=mediaScope(req,params);
        if(req.query.folder_id === 'root') sql+=' AND m.folder_id IS NULL';
        else if(req.query.folder_id) { params.push(req.query.folder_id); sql+=` AND m.folder_id=$${params.length}`; }
        if(req.query.search){params.push('%'+req.query.search+'%');sql+=` AND m.title ILIKE $${params.length}`;}
        sql+=' ORDER BY m.created_at DESC';
        res.json((await q(sql,params)).rows);
      }catch(e){res.status(500).json({error:e.message});}
    });
    app.post('/api/v4/media/upload', adminOnly, upload.array('files',200), async (req,res) => {
      const created=[]; const failures=[];
      try {
        const manifest=JSON.parse(req.body.paths||'[]');
        const target=await folderById(req.body.folder_id||null);
        const requestedClient=req.body.client_id||null;
        const clientId=target ? target.client_id : requestedClient;
        for(let i=0;i<(req.files||[]).length;i++){
          const file=req.files[i];
          try{
            const relative=String(manifest[i] || file.originalname).replace(/\\/g,'/');
            const parts=relative.split('/').filter(Boolean);
            const name=parts.pop() || file.originalname;
            const folderId=await ensurePath(parts,clientId,target?target.id:null);
            const type=file.mimetype.startsWith('video/')?'VIDEO':'IMAGE';
            const r=await q(`INSERT INTO cx_media(client_id,folder_id,title,file_name,original_name,mime_type,media_type,bytes)
              VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
              [clientId||null,folderId||target?.id||null,path.parse(name).name,file.filename,name,file.mimetype,type,file.size]);
            created.push(r.rows[0]);
          }catch(e){failures.push({file:file.originalname,error:e.message});}
        }
        res.status(201).json({ok:true,created,failures});
      }catch(e){res.status(500).json({error:e.message});}
    });
    app.put('/api/v4/media/move', adminOnly, async (req,res) => {
      try {
        const ids=(req.body.ids||[]).map(Number).filter(Boolean);
        const folder=await folderById(req.body.folder_id||null);
        if(!ids.length)return res.status(400).json({error:'Aucun média sélectionné'});
        await q('UPDATE cx_media SET folder_id=$1,client_id=COALESCE($2,client_id) WHERE id=ANY($3::int[])',[folder?.id||null,folder?.client_id||null,ids]);
        res.json({ok:true,count:ids.length});
      }catch(e){res.status(500).json({error:e.message});}
    });

    // Finder screens / sites API
    async function groupById(id){const r=await q('SELECT * FROM cx_screen_groups WHERE id=$1',[id]);return r.rows[0]||null;}
    async function ensureGroup(name,clientId,parentId){
      const r=await q('SELECT * FROM cx_screen_groups WHERE name=$1 AND client_id IS NOT DISTINCT FROM $2 AND parent_id IS NOT DISTINCT FROM $3 LIMIT 1',[name,clientId||null,parentId||null]);
      if(r.rows[0])return r.rows[0];
      const p=await groupById(parentId);
      return (await q('INSERT INTO cx_screen_groups(name,client_id,parent_id,path) VALUES($1,$2,$3,$4) RETURNING *',[name,clientId||null,parentId||null,p?`${p.path||p.name}/${name}`:name])).rows[0];
    }
    app.get('/api/v4/screen-groups',auth,async(req,res)=>{
      try{const p=[];let sql=`SELECT g.*,c.name client_name,(SELECT COUNT(*)::int FROM cx_screens s WHERE s.group_id=g.id) screen_count FROM cx_screen_groups g LEFT JOIN cx_clients c ON c.id=g.client_id WHERE 1=1`;
      if(req.session.userRole==='CLIENT'){p.push(req.session.clientId);sql+=` AND g.client_id=$${p.length}`;}sql+=' ORDER BY COALESCE(g.path,g.name),g.name';res.json((await q(sql,p)).rows);}
      catch(e){res.status(500).json({error:e.message});}
    });
    app.post('/api/v4/screen-groups',adminOnly,async(req,res)=>{
      try{const name=String(req.body.name||'').trim();if(!name)return res.status(400).json({error:'Nom requis'});const parent=await groupById(req.body.parent_id||null);res.status(201).json(await ensureGroup(name,parent?parent.client_id:(req.body.client_id||null),parent?.id||null));}
      catch(e){res.status(500).json({error:e.message});}
    });
    app.get('/api/v4/screens',auth,async(req,res)=>{
      try{const p=[];let sql=`SELECT s.*,c.name client_name,g.name group_name,g.path group_path,pa.name playlist_a_name,pb.name playlist_b_name FROM cx_screens s
      LEFT JOIN cx_clients c ON c.id=s.client_id LEFT JOIN cx_screen_groups g ON g.id=s.group_id
      LEFT JOIN cx_playlists pa ON pa.id=s.playlist_a_id LEFT JOIN cx_playlists pb ON pb.id=s.playlist_b_id WHERE 1=1`;
      if(req.session.userRole==='CLIENT'){p.push(req.session.clientId);sql+=` AND s.client_id=$${p.length}`;}
      if(req.query.group_id==='root')sql+=' AND s.group_id IS NULL';
      else if(req.query.group_id){p.push(req.query.group_id);sql+=` AND s.group_id=$${p.length}`;}
      if(req.query.search){p.push('%'+req.query.search+'%');sql+=` AND (s.name ILIKE $${p.length} OR s.pairing_code ILIKE $${p.length} OR c.name ILIKE $${p.length} OR g.path ILIKE $${p.length})`;}
      sql+=' ORDER BY s.name';res.json((await q(sql,p)).rows);}
      catch(e){res.status(500).json({error:e.message});}
    });
    app.put('/api/v4/screens/move',adminOnly,async(req,res)=>{
      try{const ids=(req.body.ids||[]).map(Number).filter(Boolean);const group=await groupById(req.body.group_id||null);if(!ids.length)return res.status(400).json({error:'Aucun écran sélectionné'});await q('UPDATE cx_screens SET group_id=$1,client_id=COALESCE($2,client_id),sync_version=COALESCE(sync_version,0)+1 WHERE id=ANY($3::int[])',[group?.id||null,group?.client_id||null,ids]);const x=await q('SELECT pairing_code FROM cx_screens WHERE id=ANY($1::int[])',[ids]);notifyScreens(x.rows);res.json({ok:true,count:ids.length});}
      catch(e){res.status(500).json({error:e.message});}
    });
    app.put('/api/v4/screens/:id/crop',adminOnly,async(req,res)=>{
      try{const v=k=>Math.max(0,Number(req.body[k])||0);const r=await q(`UPDATE cx_screens SET crop_top=$1,crop_right=$2,crop_bottom=$3,crop_left=$4,sync_version=COALESCE(sync_version,0)+1 WHERE id=$5 RETURNING *`,[v('crop_top'),v('crop_right'),v('crop_bottom'),v('crop_left'),req.params.id]);if(!r.rows[0])return res.status(404).json({error:'Écran introuvable'});notifyPlayer(r.rows[0].pairing_code,{type:'sync'});res.json(r.rows[0]);}catch(e){res.status(500).json({error:e.message});}
    });

    // Scheduling
    app.get('/api/v4/screens/:id/schedule-rules',auth,async(req,res)=>{
      try{const r=await q(`SELECT r.*,p.name playlist_name FROM cx_screen_schedule_rules r JOIN cx_playlists p ON p.id=r.playlist_id WHERE r.screen_id=$1 ORDER BY r.zone,r.priority DESC,r.id DESC`,[req.params.id]);res.json(r.rows);}catch(e){res.status(500).json({error:e.message});}
    });
    app.post('/api/v4/screens/:id/schedule-rules',adminOnly,async(req,res)=>{
      try{const b=req.body;const r=await q(`INSERT INTO cx_screen_schedule_rules(screen_id,zone,playlist_id,name,priority,active,start_date,end_date,days,time_from,time_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [req.params.id,b.zone==='B'?'B':'A',b.playlist_id,b.name||null,Number(b.priority)||100,b.active!==false,b.start_date||null,b.end_date||null,b.days||'all',b.time_from||null,b.time_to||null]);const s=await q('UPDATE cx_screens SET sync_version=COALESCE(sync_version,0)+1 WHERE id=$1 RETURNING pairing_code',[req.params.id]);notifyPlayer(s.rows[0]?.pairing_code,{type:'sync'});res.status(201).json(r.rows[0]);}catch(e){res.status(500).json({error:e.message});}
    });
    app.delete('/api/v4/schedule-rules/:id',adminOnly,async(req,res)=>{
      try{const r=await q('DELETE FROM cx_screen_schedule_rules WHERE id=$1 RETURNING screen_id',[req.params.id]);if(r.rows[0]){const s=await q('UPDATE cx_screens SET sync_version=COALESCE(sync_version,0)+1 WHERE id=$1 RETURNING pairing_code',[r.rows[0].screen_id]);notifyPlayer(s.rows[0]?.pairing_code,{type:'sync'});}res.json({ok:true});}catch(e){res.status(500).json({error:e.message});}
    });

    // Scheduled player response. Registered before the historical route so V6 and V7 players
    // both receive screen rules immediately after this Admin patch is installed.
    async function playerResponse(req,res) {
      try{
        const found=await q('SELECT * FROM cx_screens WHERE pairing_code=$1',[String(req.params.code||'').toUpperCase()]);
        const screen=found.rows[0];if(!screen)return res.status(404).json({error:'Code introuvable'});
        await q('UPDATE cx_screens SET last_seen_at=NOW(),player_version=COALESCE($1,player_version) WHERE id=$2',[req.get('X-CX-View-Version')||null,screen.id]);
        const rules=(await q('SELECT * FROM cx_screen_schedule_rules WHERE screen_id=$1 AND active=true ORDER BY priority DESC,id DESC',[screen.id])).rows.filter(isRuleActive);
        const ruleA=rules.find(x=>x.zone==='A'),ruleB=rules.find(x=>x.zone==='B');
        const now=brusselsNow();
        const items=async playlistId=>{
          if(!playlistId)return[];
          const r=await q(`SELECT pi.*,m.file_name,m.title,m.mime_type,m.media_type,m.thumbnail_name
            FROM cx_playlist_items pi LEFT JOIN cx_media m ON m.id=pi.media_id
            WHERE pi.playlist_id=$1 AND pi.active=true ORDER BY pi.position`,[playlistId]);
          return r.rows.filter(x=>{
            if(x.schedule_start && String(x.schedule_start).slice(0,10)>now.date)return false;
            if(x.schedule_end && String(x.schedule_end).slice(0,10)<now.date)return false;
            if(x.schedule_days&&x.schedule_days!=='all'&&!String(x.schedule_days).split(',').includes(now.day))return false;
            if(x.schedule_time_from&&now.time<String(x.schedule_time_from).slice(0,5))return false;
            if(x.schedule_time_to&&now.time>String(x.schedule_time_to).slice(0,5))return false;
            return true;
          }).map(x=>({...x,url:x.file_name?`${PUBLIC_BASE_URL}/files/uploads/${x.file_name}`:null}));
        };
        res.json({screen:{
          id:screen.id,name:screen.name,width:screen.width_px,height:screen.height_px,orientation:screen.orientation,
          layout:screen.layout,standby_color:screen.standby_color,display_mode:screen.display_mode||'WINDOW',
          monitor_id:Number(screen.monitor_id||0),sync_version:Number(screen.sync_version||0),
          crop_top:Number(screen.crop_top||0),crop_right:Number(screen.crop_right||0),
          crop_bottom:Number(screen.crop_bottom||0),crop_left:Number(screen.crop_left||0)
        },zones:{A:await items(ruleA?.playlist_id||screen.playlist_a_id),B:screen.layout!=='SINGLE'?await items(ruleB?.playlist_id||screen.playlist_b_id):[]}});
      }catch(e){res.status(500).json({error:e.message});}
    }
    app.get('/api/player/:code',playerResponse);
    app.get('/api/v4/player/:code',playerResponse);
  }
};
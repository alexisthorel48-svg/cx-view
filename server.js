require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const REBUILD_SAFE_MODE = String(process.env.REBUILD_SAFE_MODE || '').toLowerCase() === 'true';

if (REBUILD_SAFE_MODE) {
  console.log('🔒 CX-View fonctionne en REBUILD_SAFE_MODE');
}
const cxViewV31 = require('./modules/cx_view_v31');
const cxViewV3 = require('./modules/cx_view_v3');
const cxViewV24 = require('./modules/cx_view_v24');
const cxViewV241 = require('./modules/cx_view_v241');
const cxViewV242 = require('./modules/cx_view_v242');
const cxViewV25 = require('./modules/cx_view_v25');
const cxViewV26 = require('./modules/cx_view_v26');
const cxViewV27 = require('./modules/cx_view_v27');
const cxViewV28 = require('./modules/cx_view_v28');
const cxViewV29 = require('./modules/cx_view_v29');
const cxViewV30 = require('./modules/cx_view_v30');
const cxViewV32 = require('./modules/cx_view_v32');
const cxViewV33 = require('./modules/cx_view_v33');
const cxViewV34 = require('./modules/cx_view_v34');
const cxViewV35 = require('./modules/cx_view_v35');
const cxViewIntegrationsV1 = require('./modules/cx_view_integrations_v1');

// CXVIEW_REALTIME_V64
const playerSockets = new Map();
function notifyPlayer(pairingCode, payload = { type: 'sync' }) {
  if (REBUILD_SAFE_MODE) return false;
  const code = String(pairingCode || '').toUpperCase();
  const socket = playerSockets.get(code);
  if (socket && socket.readyState === 1) {
    try { socket.send(JSON.stringify(payload)); return true; } catch (_) {}
  }
  return false;
}
function notifyScreens(rows) {
  for (const row of rows || []) notifyPlayer(row.pairing_code, { type: 'sync', screenId: row.id });
}

const PORT = process.env.PORT || 4100;
const MEDIA_ROOT = process.env.MEDIA_ROOT || path.join(__dirname, 'storage');
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL || '';
const PLAYER_UPDATES_ROOT = path.join(MEDIA_ROOT, 'player-updates');
fs.mkdirSync(PLAYER_UPDATES_ROOT, { recursive: true });

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const q = (sql, p) => pool.query(sql, p);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// En reconstruction, aucune requête provenant d'un Player ne doit être traitée.
app.use((req, res, next) => {
  if (
    REBUILD_SAFE_MODE &&
    (
      req.path.startsWith('/api/player') ||
      req.path.startsWith('/api/v4/player')
    )
  ) {
    return res.status(503).json({
      error: 'Player désactivé sur cet environnement de reconstruction'
    });
  }

  next();
});
app.use('/files', express.static(MEDIA_ROOT));
app.use(express.static(path.join(__dirname, 'public')));

// CX_VIEW_V2_SPA_ROUTES
app.get([
  '/dashboard',
  '/clients',
  '/accounts',
  '/media',
  '/playlists',
  '/screens', '/scheduler',
  '/schedule',
  '/monitoring',
  '/scenes',
  '/player-updates',
  '/stats',
  '/history',
  '/design-system'
], (req, res) => {
  res.sendFile(__dirname + '/public/app.html');
});


app.use(session({
  store: new PgSession({ pool, tableName: 'cx_sessions', createTableIfMissing: false }),
  secret: process.env.SESSION_SECRET || 'cx-view-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true }
}));

const auth = (req, res, next) => {
  if (req.session && req.session.userId) return next();
  if (req.path.startsWith('/api/player')) return next();
  if (req.xhr || req.path.startsWith('/api/')) return res.status(401).json({ error: 'Non authentifié' });
  res.redirect('/login');
};

const adminOnly = (req, res, next) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  if (!['SUPER_ADMIN','ADMIN'].includes(req.session.userRole)) return res.status(403).json({ error: 'Accès refusé' });
  next();
};

const superOnly = (req, res, next) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Non authentifié' });
  if (req.session.userRole !== 'SUPER_ADMIN') return res.status(403).json({ error: 'Réservé au Super Admin' });
  next();
};

const isSuper = req => req.session && req.session.userRole === 'SUPER_ADMIN';
const sessionClientId = req => {
  const id = Number(req.session && req.session.clientId);
  return Number.isFinite(id) && id > 0 ? id : null;
};
const requireTenant = (req, res) => {
  if (isSuper(req)) return null;
  const id = sessionClientId(req);
  if (!id) res.status(403).json({ error: 'Ce compte n’est associé à aucun client.' });
  return id;
};
async function owns(req, table, id) {
  if (isSuper(req)) return true;
  const clientId = sessionClientId(req);
  if (!clientId) return false;
  const allowed = new Set(['cx_folders','cx_media','cx_playlists','cx_screens']);
  if (!allowed.has(table)) return false;
  const r = await q(`SELECT 1 FROM ${table} WHERE id=$1 AND client_id=$2`, [id, clientId]);
  return !!r.rows[0];
}
async function playlistMediaCompatible(req, playlistId, mediaIds) {
  if (isSuper(req)) return true;
  const clientId = sessionClientId(req);
  if (!clientId) return false;
  const p = await q('SELECT 1 FROM cx_playlists WHERE id=$1 AND client_id=$2', [playlistId, clientId]);
  if (!p.rows[0]) return false;
  const ids = [...new Set((mediaIds || []).map(Number).filter(Boolean))];
  if (!ids.length) return true;
  const m = await q('SELECT id FROM cx_media WHERE id=ANY($1::int[]) AND client_id=$2', [ids, clientId]);
  return m.rows.length === ids.length;
}

app.get('/login', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/logout', (req, res) => { req.session.destroy(); res.redirect('/login'); });
app.get('/playlist-preview', auth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'playlist-preview.html'));
});
app.get(['/', '/dashboard', '/media', '/playlists', '/screens', '/clients', '/workspaces', '/schedule', '/monitoring', '/scenes', '/history', '/stats', '/accounts', '/design-system'], auth, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app.html'));
});

// ─── AUTH ────────────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const r = await q('SELECT * FROM cx_users WHERE email=$1 AND active=true', [email]);
    const user = r.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Email ou mot de passe incorrect' });
    }
    req.session.userId = user.id;
    req.session.userRole = user.role;
    req.session.clientId = user.client_id;
    res.json({ ok: true, user: { id: user.id, email: user.email, display_name: user.display_name, role: user.role } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/auth/me', auth, async (req, res) => {
  const r = await q('SELECT id,email,display_name,role,client_id FROM cx_users WHERE id=$1', [req.session.userId]);
  res.json(r.rows[0] || null);
});

// ─── DASHBOARD ───────────────────────────────────────────────────────────────
app.get('/api/dashboard', auth, async (req, res) => {
  try {
    const superAdmin = isSuper(req);
    const cid = superAdmin ? null : requireTenant(req, res);
    if (!superAdmin && !cid) return;
    const scope = superAdmin ? '' : ' AND client_id=$1';
    const screenScope = superAdmin ? '' : ' WHERE client_id=$1';
    const params = superAdmin ? [] : [cid];
    const [clients, media, playlists, screens, logs, screensOnline] = await Promise.all([
      superAdmin ? q('SELECT COUNT(*) FROM cx_clients WHERE active=true') : q('SELECT COUNT(*) FROM cx_clients WHERE id=$1 AND active=true', params),
      q(`SELECT COUNT(*) FROM cx_media WHERE status='ACTIVE'${scope}`, params),
      q(`SELECT COUNT(*) FROM cx_playlists WHERE 1=1${scope}`, params),
      q(`SELECT COUNT(*) FROM cx_screens${screenScope}`, params),
      superAdmin
        ? q("SELECT COUNT(*) FROM cx_logs WHERE played_at > NOW() - INTERVAL '24 hours'")
        : q("SELECT COUNT(*) FROM cx_logs l JOIN cx_screens s ON s.id=l.screen_id WHERE l.played_at > NOW() - INTERVAL '24 hours' AND s.client_id=$1", params),
      superAdmin
        ? q("SELECT COUNT(*) FROM cx_screens WHERE last_seen_at > NOW() - INTERVAL '5 minutes'")
        : q("SELECT COUNT(*) FROM cx_screens WHERE last_seen_at > NOW() - INTERVAL '5 minutes' AND client_id=$1", params)
    ]);
    let diskUsed = 0;
    if (superAdmin) {
      const uploadsDir = path.join(MEDIA_ROOT, 'uploads');
      if (fs.existsSync(uploadsDir)) {
        fs.readdirSync(uploadsDir).forEach(f => {
          try { diskUsed += fs.statSync(path.join(uploadsDir, f)).size; } catch {}
        });
      }
    } else {
      const bytes = await q("SELECT COALESCE(SUM(file_size),0)::bigint AS total FROM cx_media WHERE status='ACTIVE' AND client_id=$1", params).catch(() => ({rows:[{total:0}]}));
      diskUsed = Number(bytes.rows[0]?.total || 0);
    }
    let vpsStorage = null;
    if (superAdmin) {
      try {
        const stats = fs.statfsSync('/');
        const blockSize = Number(stats.bsize || 0);
        const totalBytes = Number(stats.blocks || 0) * blockSize;
        const freeBytes = Number(stats.bavail || stats.bfree || 0) * blockSize;
        const usedBytes = Math.max(0, totalBytes - freeBytes);
        const usedPercent = totalBytes > 0 ? Math.round((usedBytes / totalBytes) * 1000) / 10 : 0;
        vpsStorage = { totalBytes, usedBytes, freeBytes, usedPercent };
      } catch (diskError) {
        console.error('VPS storage stats:', diskError.message);
      }
    }
    res.json({
      clients: parseInt(clients.rows[0].count),
      media: parseInt(media.rows[0].count),
      playlists: parseInt(playlists.rows[0].count),
      screens: parseInt(screens.rows[0].count),
      screensOnline: parseInt(screensOnline.rows[0].count),
      logsToday: parseInt(logs.rows[0].count),
      diskUsedMb: Math.round(diskUsed / 1024 / 1024),
      tenantScoped: !superAdmin,
      ...(superAdmin ? { vpsStorage } : {})
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── ACCOUNTS ────────────────────────────────────────────────────────────────
app.get('/api/accounts', adminOnly, async (req, res) => {
  const params = [];
  let sql = 'SELECT u.id,u.email,u.display_name,u.role,u.active,u.created_at,u.client_id,c.name as client_name FROM cx_users u LEFT JOIN cx_clients c ON c.id=u.client_id';
  if (!isSuper(req)) { const cid=requireTenant(req,res); if (!cid) return; params.push(cid); sql += ' WHERE u.client_id=$1'; }
  sql += ' ORDER BY u.created_at DESC';
  const r = await q(sql, params); res.json(r.rows);
});
app.post('/api/accounts', adminOnly, async (req, res) => {
  try {
    const { email, password, display_name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email et mot de passe requis' });
    const clientId = isSuper(req) ? (req.body.client_id || null) : requireTenant(req,res);
    if (!isSuper(req) && !clientId) return;
    const role = isSuper(req) ? (req.body.role || 'ADMIN') : (req.body.role === 'USER' ? 'USER' : 'ADMIN');
    const hash = await bcrypt.hash(password, 12);
    const r = await q('INSERT INTO cx_users(email,password_hash,display_name,role,client_id) VALUES($1,$2,$3,$4,$5) RETURNING id,email,display_name,role,active,client_id,created_at', [email,hash,display_name||email,role,clientId]);
    res.json(r.rows[0]);
  } catch(e){ res.status(400).json({error:e.message}); }
});
app.put('/api/accounts/:id', adminOnly, async (req,res)=>{
  try {
    const target = await q('SELECT * FROM cx_users WHERE id=$1',[req.params.id]);
    const user=target.rows[0]; if(!user) return res.status(404).json({error:'Utilisateur introuvable'});
    if(!isSuper(req) && Number(user.client_id)!==sessionClientId(req)) return res.status(403).json({error:'Accès refusé'});
    if(!isSuper(req) && user.role==='SUPER_ADMIN') return res.status(403).json({error:'Accès refusé'});
    if(req.body.password){ const hash=await bcrypt.hash(req.body.password,12); await q('UPDATE cx_users SET password_hash=$1 WHERE id=$2',[hash,user.id]); }
    const clientId=isSuper(req)?(req.body.client_id||null):sessionClientId(req);
    const role=isSuper(req)?(req.body.role||user.role):(req.body.role==='USER'?'USER':'ADMIN');
    const r=await q('UPDATE cx_users SET email=$1,display_name=$2,role=$3,client_id=$4,active=$5 WHERE id=$6 RETURNING id,email,display_name,role,active,client_id',[req.body.email,req.body.display_name,role,clientId,req.body.active!==false,user.id]);
    res.json(r.rows[0]);
  }catch(e){res.status(400).json({error:e.message});}
});
app.delete('/api/accounts/:id', adminOnly, async(req,res)=>{
  if(Number(req.params.id)===Number(req.session.userId)) return res.status(400).json({error:'Impossible de supprimer votre propre compte'});
  const target=await q('SELECT role,client_id FROM cx_users WHERE id=$1',[req.params.id]);
  const user=target.rows[0]; if(!user) return res.status(404).json({error:'Utilisateur introuvable'});
  if(!isSuper(req) && (Number(user.client_id)!==sessionClientId(req) || user.role==='SUPER_ADMIN')) return res.status(403).json({error:'Accès refusé'});
  await q('DELETE FROM cx_users WHERE id=$1',[req.params.id]); res.json({ok:true});
});

// ─── CLIENTS ─────────────────────────────────────────────────────────────────
app.get('/api/clients', auth, async (req, res) => {
  if (req.session.userRole === 'SUPER_ADMIN') {
    const r = await q('SELECT * FROM cx_clients ORDER BY name');
    return res.json(r.rows);
  }
  const clientId = Number(req.session.clientId);
  if (!clientId) return res.status(403).json({ error: 'Ce compte n’est associé à aucun client.' });
  const r = await q('SELECT * FROM cx_clients WHERE id=$1', [clientId]);
  res.json(r.rows);
});
app.post('/api/clients', superOnly, async (req, res) => {
  try {
    const { name, contact_email } = req.body;
    const r = await q('INSERT INTO cx_clients(name,contact_email) VALUES($1,$2) RETURNING *', [name, contact_email || null]);
    res.json(r.rows[0]);
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.put('/api/clients/:id', superOnly, async (req, res) => {
  const { name, contact_email, active } = req.body;
  const r = await q('UPDATE cx_clients SET name=$1,contact_email=$2,active=$3 WHERE id=$4 RETURNING *', [name, contact_email || null, active !== false, req.params.id]);
  res.json(r.rows[0]);
});
app.delete('/api/clients/:id', superOnly, async (req, res) => {
  await q('DELETE FROM cx_clients WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

cxViewV31.register({ app, q, auth, adminOnly, superOnly, notifyPlayer, notifyScreens, MEDIA_ROOT, PUBLIC_BASE_URL });
cxViewV24.register({ app, q, auth, adminOnly, superOnly, notifyPlayer });
cxViewV241.register({ app, q, auth, adminOnly, notifyPlayer });
cxViewV242.register({ app, q, auth, adminOnly, notifyPlayer });
cxViewV25.register({ app, q, pool, auth, adminOnly, notifyPlayer });
cxViewV26.register({ app, q, auth, adminOnly, notifyPlayer });
cxViewV27.register({ app, q, auth, adminOnly, notifyPlayer, MEDIA_ROOT, PUBLIC_BASE_URL });

// ─── FOLDERS ─────────────────────────────────────────────────────────────────
app.get('/api/folders', auth, async (req, res) => {
  const cid=isSuper(req)?null:requireTenant(req,res); if(!isSuper(req)&&!cid)return; const r=await q('SELECT f.*,c.name as client_name FROM cx_folders f LEFT JOIN cx_clients c ON c.id=f.client_id'+(isSuper(req)?'':' WHERE f.client_id=$1')+' ORDER BY f.name',isSuper(req)?[]:[cid]);
  res.json(r.rows);
});
app.post('/api/folders', adminOnly, async (req, res) => {
  const { name, client_id, parent_id } = req.body;
  const r = await q('INSERT INTO cx_folders(name,client_id,parent_id) VALUES($1,$2,$3) RETURNING *', [name, isSuper(req)?(client_id||null):requireTenant(req,res), parent_id || null]);
  res.json(r.rows[0]);
});
app.put('/api/folders/:id', adminOnly, async (req, res) => {
  if (!(await owns(req,'cx_folders',req.params.id))) return res.status(403).json({error:'Accès refusé'});
  const { name, client_id } = req.body;
  const r = await q('UPDATE cx_folders SET name=$1,client_id=$2 WHERE id=$3 RETURNING *', [name, isSuper(req)?(client_id||null):sessionClientId(req), req.params.id]);
  res.json(r.rows[0]);
});
app.delete('/api/folders/:id', adminOnly, async (req, res) => {
  if (!(await owns(req,'cx_folders',req.params.id))) return res.status(403).json({error:'Accès refusé'});
  await q('DELETE FROM cx_folders WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ─── MEDIA ───────────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(MEDIA_ROOT, 'uploads')),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomUUID() + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024 } });
const playerUpdateStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, PLAYER_UPDATES_ROOT),
  filename: (req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase())
});
const playerUpdateUpload = multer({
  storage: playerUpdateStorage,
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.exe') return cb(new Error('Le paquet Player doit être un installateur .exe'));
    cb(null, true);
  }
});

app.get('/api/media', auth, async (req, res) => {
  let sql = `SELECT m.*,c.name as client_name,f.name as folder_name
             FROM cx_media m
             LEFT JOIN cx_clients c ON c.id=m.client_id
             LEFT JOIN cx_folders f ON f.id=m.folder_id
             WHERE m.status != 'PENDING_DELETE'`;
  const params = [];
  if (!isSuper(req)) { const cid=requireTenant(req,res); if(!cid)return; params.push(cid); sql += ` AND m.client_id=$${params.length}`; }
  if (isSuper(req) && req.query.client_id) { params.push(req.query.client_id); sql += ` AND m.client_id=$${params.length}`; }
  if (req.query.folder_id) { params.push(req.query.folder_id); sql += ` AND m.folder_id=$${params.length}`; }
  if (req.query.type) { params.push(req.query.type); sql += ` AND m.media_type=$${params.length}`; }
  if (req.query.status) { params.push(req.query.status); sql += ` AND m.status=$${params.length}`; }
  if (req.query.search) { params.push(`%${req.query.search}%`); sql += ` AND m.title ILIKE $${params.length}`; }
  sql += ' ORDER BY m.created_at DESC';
  const r = await q(sql, params);
  res.json(r.rows);
});

app.post('/api/media/upload', adminOnly, upload.array('files', 50), async (req, res) => {
  const results = [];
  for (const file of req.files) {
    try {
      const isVideo = file.mimetype.startsWith('video/');
      const mediaType = isVideo ? 'VIDEO' : 'IMAGE';
      let thumbName = null;
      if (!isVideo) {
        try {
          const sharp = require('sharp');
          thumbName = 'thumb_' + file.filename + '.jpg';
          await sharp(file.path).resize(320, 180, { fit: 'cover' }).jpeg({ quality: 80 }).toFile(path.join(MEDIA_ROOT, 'thumbs', thumbName));
        } catch {}
      } else {
        try {
          const ffmpeg = require('fluent-ffmpeg');
          thumbName = 'thumb_' + file.filename + '.jpg';
          await new Promise((resolve, reject) => {
            ffmpeg(file.path).screenshots({ count: 1, folder: path.join(MEDIA_ROOT, 'thumbs'), filename: thumbName, size: '320x180' }).on('end', resolve).on('error', reject);
          });
        } catch {}
      }
      const r = await q(
        `INSERT INTO cx_media(client_id,folder_id,title,file_name,original_name,mime_type,media_type,bytes,thumbnail_name)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [isSuper(req)?(req.body.client_id||null):requireTenant(req,res), req.body.folder_id || null, path.parse(file.originalname).name, file.filename, file.originalname, file.mimetype, mediaType, file.size, thumbName]
      );
      results.push({ ok: true, media: r.rows[0] });
    } catch (e) { results.push({ ok: false, file: file.originalname, error: e.message }); }
  }
  res.json(results);
});

app.put('/api/media/:id', adminOnly, async (req, res) => {
  if (!(await owns(req,'cx_media',req.params.id))) return res.status(403).json({error:'Accès refusé'});
  const { title, folder_id, client_id, keep_forever, delete_after } = req.body;
  const r = await q(
    'UPDATE cx_media SET title=$1,folder_id=$2,client_id=$3,keep_forever=$4,delete_after=$5 WHERE id=$6 RETURNING *',
    [title, folder_id || null, isSuper(req)?(client_id||null):sessionClientId(req), keep_forever || false, delete_after || null, req.params.id]
  );
  res.json(r.rows[0]);
});

app.delete('/api/media/:id', adminOnly, async (req, res) => {
  if (!(await owns(req,'cx_media',req.params.id))) return res.status(403).json({error:'Accès refusé'});
  const r = await q('SELECT * FROM cx_media WHERE id=$1', [req.params.id]);
  const media = r.rows[0];
  if (!media) return res.status(404).json({ error: 'Introuvable' });
  try { fs.unlinkSync(path.join(MEDIA_ROOT, 'uploads', media.file_name)); } catch {}
  if (media.thumbnail_name) { try { fs.unlinkSync(path.join(MEDIA_ROOT, 'thumbs', media.thumbnail_name)); } catch {} }
  await q('DELETE FROM cx_media WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

// ─── PLAYLISTS ────────────────────────────────────────────────────────────────
app.get('/api/playlists', auth, async (req, res) => {
  const cid=isSuper(req)?null:requireTenant(req,res); if(!isSuper(req)&&!cid)return;
  const r = await q(`SELECT p.*,c.name as client_name,COUNT(pi.id) as item_count
                     FROM cx_playlists p LEFT JOIN cx_clients c ON c.id=p.client_id
                     LEFT JOIN cx_playlist_items pi ON pi.playlist_id=p.id
                     ${isSuper(req)?'':'WHERE p.client_id=$1'} GROUP BY p.id,c.name ORDER BY p.name`, isSuper(req)?[]:[cid]);
  res.json(r.rows);
});
app.post('/api/playlists', adminOnly, async (req, res) => {
  const { name, client_id, description } = req.body;
  const r = await q('INSERT INTO cx_playlists(name,client_id,description) VALUES($1,$2,$3) RETURNING *', [name, isSuper(req)?(client_id||null):requireTenant(req,res), description || null]);
  res.json(r.rows[0]);
});
app.put('/api/playlists/:id', adminOnly, async (req, res) => {
  if (!(await owns(req,'cx_playlists',req.params.id))) return res.status(403).json({error:'Accès refusé'});
  const { name, client_id, description } = req.body;
  const r = await q('UPDATE cx_playlists SET name=$1,client_id=$2,description=$3 WHERE id=$4 RETURNING *', [name, isSuper(req)?(client_id||null):sessionClientId(req), description || null, req.params.id]);
  res.json(r.rows[0]);
});
app.delete('/api/playlists/:id', adminOnly, async (req, res) => {
  if (!(await owns(req,'cx_playlists',req.params.id))) return res.status(403).json({error:'Accès refusé'});
  await q('DELETE FROM cx_playlists WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.get('/api/playlists/:id/items', auth, async (req, res) => {
  if (!(await owns(req,'cx_playlists',req.params.id))) return res.status(403).json({error:'Accès refusé'});
  const r = await q(`SELECT pi.*,m.title,m.thumbnail_name,m.media_type,m.file_name
                     FROM cx_playlist_items pi
                     LEFT JOIN cx_media m ON m.id=pi.media_id
                     WHERE pi.playlist_id=$1 ORDER BY pi.position`, [req.params.id]);
  res.json(r.rows);
});

app.post('/api/playlists/:id/items', adminOnly, async (req, res) => {
  if (!(await playlistMediaCompatible(req,req.params.id,[req.body.media_id]))) return res.status(403).json({error:'Playlist ou média inaccessible'});
  const { item_type, media_id, widget_type, widget_config, position, duration_seconds, play_forever,
          schedule_start, schedule_end, schedule_days, schedule_time_from, schedule_time_to,
          is_priority, priority_interval_minutes, priority_count } = req.body;
  const r = await q(
    `INSERT INTO cx_playlist_items(playlist_id,item_type,media_id,widget_type,widget_config,position,duration_seconds,play_forever,
     schedule_start,schedule_end,schedule_days,schedule_time_from,schedule_time_to,
     is_priority,priority_interval_minutes,priority_count)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [req.params.id, item_type||'MEDIA', media_id||null, widget_type||null,
     widget_config ? JSON.stringify(widget_config) : '{}',
     position||0, duration_seconds||10, !!play_forever,
     schedule_start||null, schedule_end||null, schedule_days||'all',
     schedule_time_from||null, schedule_time_to||null,
     is_priority||false, priority_interval_minutes||null, priority_count||1]
  );
  res.json(r.rows[0]);
});

// V0.13 — opérations groupées et duplication des playlists
app.post('/api/playlists/:id/items/bulk', adminOnly, async (req, res) => {
  const mediaIds = Array.isArray(req.body.media_ids) ? req.body.media_ids.map(Number).filter(Boolean) : [];
  const duration = Math.max(1, Number(req.body.duration_seconds) || 10);
  if (!mediaIds.length) return res.status(400).json({ error: 'Aucun média sélectionné' });
  if (!(await playlistMediaCompatible(req,req.params.id,mediaIds))) return res.status(403).json({error:'Playlist ou média inaccessible'});
  const pos = await q('SELECT COALESCE(MAX(position),-1) AS max FROM cx_playlist_items WHERE playlist_id=$1', [req.params.id]);
  let position = Number(pos.rows[0].max) + 1;
  const created = [];
  for (const mediaId of mediaIds) {
    const r = await q(
      `INSERT INTO cx_playlist_items(playlist_id,item_type,media_id,position,duration_seconds,play_forever,
       schedule_days,is_priority,priority_count,widget_config)
       VALUES($1,'MEDIA',$2,$3,$4,false,'all',false,1,'{}') RETURNING *`,
      [req.params.id, mediaId, position++, duration]
    );
    created.push(r.rows[0]);
  }
  res.json({ ok: true, items: created });
});

app.put('/api/playlists/:pid/items/bulk', adminOnly, async (req, res) => {
  if (!(await owns(req,'cx_playlists',req.params.pid))) return res.status(403).json({error:'Accès refusé'});
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  const patch = req.body.patch || {};
  if (!ids.length) return res.status(400).json({ error: 'Aucun contenu sélectionné' });
  const allowed = {
    duration_seconds: v => Math.max(1, Number(v) || 10),
    active: v => v !== false,
    schedule_start: v => v || null,
    schedule_end: v => v || null,
    schedule_days: v => v || 'all',
    schedule_time_from: v => v || null,
    schedule_time_to: v => v || null,
    play_forever: v => !!v,
    is_priority: v => !!v,
    priority_interval_minutes: v => v ? Number(v) : null,
    priority_count: v => Math.max(1, Number(v) || 1)
  };
  const keys = Object.keys(patch).filter(k => allowed[k]);
  if (!keys.length) return res.status(400).json({ error: 'Aucun paramètre compatible' });
  const values = keys.map(k => allowed[k](patch[k]));
  const setSql = keys.map((k, i) => `${k}=$${i + 1}`).join(',');
  values.push(req.params.pid, ids);
  await q(`UPDATE cx_playlist_items SET ${setSql} WHERE playlist_id=$${keys.length + 1} AND id=ANY($${keys.length + 2}::int[])`, values);
  res.json({ ok: true, updated: ids.length });
});

app.post('/api/playlists/:pid/items/delete-bulk', adminOnly, async (req, res) => {
  if (!(await owns(req,'cx_playlists',req.params.pid))) return res.status(403).json({error:'Accès refusé'});
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Aucun contenu sélectionné' });
  await q('DELETE FROM cx_playlist_items WHERE playlist_id=$1 AND id=ANY($2::int[])', [req.params.pid, ids]);
  res.json({ ok: true, deleted: ids.length });
});

app.delete('/api/playlists/:id/items', adminOnly, async (req, res) => {
  if (!(await owns(req,'cx_playlists',req.params.id))) return res.status(403).json({error:'Accès refusé'});
  await q('DELETE FROM cx_playlist_items WHERE playlist_id=$1', [req.params.id]);
  res.json({ ok: true });
});

app.post('/api/playlists/:id/duplicate', adminOnly, async (req, res) => {
  if (!(await owns(req,'cx_playlists',req.params.id))) return res.status(403).json({error:'Accès refusé'});
  const source = await q('SELECT * FROM cx_playlists WHERE id=$1', [req.params.id]);
  if (!source.rows[0]) return res.status(404).json({ error: 'Playlist introuvable' });
  const p = source.rows[0];
  const copy = await q(
    'INSERT INTO cx_playlists(name,client_id,description) VALUES($1,$2,$3) RETURNING *',
    [`${p.name} — copie`, p.client_id, p.description]
  );
  await q(
    `INSERT INTO cx_playlist_items(playlist_id,item_type,media_id,widget_type,widget_config,position,duration_seconds,
      play_forever,active,is_priority,priority_interval_minutes,priority_count,schedule_start,schedule_end,schedule_days,
      schedule_time_from,schedule_time_to)
     SELECT $1,item_type,media_id,widget_type,widget_config,position,duration_seconds,play_forever,active,is_priority,
      priority_interval_minutes,priority_count,schedule_start,schedule_end,schedule_days,schedule_time_from,schedule_time_to
     FROM cx_playlist_items WHERE playlist_id=$2 ORDER BY position`,
    [copy.rows[0].id, req.params.id]
  );
  res.json(copy.rows[0]);
});

app.put('/api/playlists/:pid/items/:id', adminOnly, async (req, res) => {
  if (!(await owns(req,'cx_playlists',req.params.pid))) return res.status(403).json({error:'Accès refusé'});
  const { duration_seconds, position, active, schedule_start, schedule_end, schedule_days,
          schedule_time_from, schedule_time_to, widget_config, play_forever,
          is_priority, priority_interval_minutes, priority_count } = req.body;
  const r = await q(
    `UPDATE cx_playlist_items SET duration_seconds=$1,position=$2,active=$3,
     schedule_start=$4,schedule_end=$5,schedule_days=$6,schedule_time_from=$7,schedule_time_to=$8,
     widget_config=$9,play_forever=$10,is_priority=$11,priority_interval_minutes=$12,priority_count=$13
     WHERE id=$14 AND playlist_id=$15 RETURNING *`,
    [duration_seconds, position, active !== false, schedule_start||null, schedule_end||null,
     schedule_days||'all', schedule_time_from||null, schedule_time_to||null,
     widget_config ? JSON.stringify(widget_config) : '{}', !!play_forever,
     is_priority||false, priority_interval_minutes||null, priority_count||1,
     req.params.id, req.params.pid]
  );
  res.json(r.rows[0]);
});

app.delete('/api/playlists/:pid/items/:id', adminOnly, async (req, res) => {
  if (!(await owns(req,'cx_playlists',req.params.pid))) return res.status(403).json({error:'Accès refusé'});
  await q('DELETE FROM cx_playlist_items WHERE id=$1 AND playlist_id=$2', [req.params.id, req.params.pid]);
  res.json({ ok: true });
});

app.post('/api/playlists/:id/reorder', adminOnly, async (req, res) => {
  if (!(await owns(req,'cx_playlists',req.params.id))) return res.status(403).json({error:'Accès refusé'});
  const { order } = req.body;
  for (const item of order) {
    await q('UPDATE cx_playlist_items SET position=$1 WHERE id=$2 AND playlist_id=$3', [item.position, item.id, req.params.id]);
  }
  res.json({ ok: true });
});

// ─── SCREENS ─────────────────────────────────────────────────────────────────
app.get('/api/screens', auth, async (req, res) => {
  const r = await q(`SELECT s.*,c.name as client_name,
                     pa.name as playlist_a_name, pb.name as playlist_b_name
                     FROM cx_screens s
                     LEFT JOIN cx_clients c ON c.id=s.client_id
                     LEFT JOIN cx_playlists pa ON pa.id=s.playlist_a_id
                     LEFT JOIN cx_playlists pb ON pb.id=s.playlist_b_id
                     ${isSuper(req)?'':'WHERE s.client_id=$1'} ORDER BY s.name`, isSuper(req)?[]:[requireTenant(req,res)]);
  res.json(r.rows);
});
app.post('/api/screens', adminOnly, async (req, res) => {
  if (!isSuper(req)) return res.status(403).json({ error: "Création d'écran réservée au Super Admin" });
  try {
    const { name, client_id, width_px, height_px, orientation, layout, playlist_a_id, playlist_b_id,
      standby_color, display_mode, monitor_id } = req.body;
    if (!String(name || '').trim()) return res.status(400).json({ error: 'Nom de l’écran requis' });

    // La création d’écran est strictement réservée au SUPER_ADMIN.
    const effectiveClientId = client_id || null;

    const code = Math.random().toString(36).substring(2, 8).toUpperCase();
    const r = await q(
      `INSERT INTO cx_screens(name,client_id,pairing_code,width_px,height_px,orientation,layout,
       playlist_a_id,playlist_b_id,standby_color,display_mode,monitor_id,sync_version)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1) RETURNING *`,
      [String(name).trim(), effectiveClientId, code, Math.max(100, Number(width_px) || 1920),
       Math.max(100, Number(height_px) || 1080), Number(orientation) || 0, layout || 'SINGLE',
       playlist_a_id || null, playlist_b_id || null, standby_color || '#000000',
       display_mode === 'KIOSK' ? 'KIOSK' : 'WINDOW', Math.max(0, Number(monitor_id) || 0)]
    );


    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.put('/api/screens/:id', adminOnly, async (req, res) => {
  try {
    if (!(await owns(req,'cx_screens',req.params.id))) return res.status(403).json({error:'Accès refusé'});
    const { name, client_id, width_px, height_px, orientation, layout, playlist_a_id, playlist_b_id,
      standby_color, display_mode, monitor_id } = req.body;
    const r = await q(
      `UPDATE cx_screens SET name=$1,client_id=$2,width_px=$3,height_px=$4,orientation=$5,layout=$6,
       playlist_a_id=$7,playlist_b_id=$8,standby_color=$9,display_mode=$10,monitor_id=$11,
       sync_version=COALESCE(sync_version,0)+1 WHERE id=$12 RETURNING *`,
      [name, isSuper(req)?(client_id||null):sessionClientId(req), Math.max(100, Number(width_px) || 1920),
       Math.max(100, Number(height_px) || 1080), Number(orientation) || 0, layout || 'SINGLE',
       playlist_a_id || null, playlist_b_id || null, standby_color || '#000000',
       display_mode === 'KIOSK' ? 'KIOSK' : 'WINDOW', Math.max(0, Number(monitor_id) || 0), req.params.id]
    );
    if (!r.rows[0]) return res.status(404).json({ error: 'Écran introuvable' });
    notifyPlayer(r.rows[0].pairing_code, { type: 'sync', screenId: r.rows[0].id });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.delete('/api/screens/:id', superOnly, async (req, res) => {
  await q('DELETE FROM cx_screens WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});
app.post('/api/screens/:id/sync', adminOnly, async (req, res) => {
  try {
    if (!(await owns(req,'cx_screens',req.params.id))) return res.status(403).json({error:'Accès refusé'});
    const updated = await q(
      'UPDATE cx_screens SET sync_version=COALESCE(sync_version,0)+1 WHERE id=$1 RETURNING id,name,pairing_code,sync_version',
      [req.params.id]
    );
    if (!updated.rows[0]) return res.status(404).json({ error: 'Écran introuvable' });
    notifyPlayer(updated.rows[0].pairing_code, { type: 'sync' });
    res.json({ ok: true, synced: true, screen: updated.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── STATS ───────────────────────────────────────────────────────────────────
app.get('/api/stats', auth, async (req, res) => {
  try {
    let sql = `SELECT m.id,m.title,m.media_type,m.thumbnail_name,c.name as client_name,
               COUNT(l.id) as play_count,
               SUM(COALESCE(pi.duration_seconds,10)) as total_seconds,
               MAX(l.played_at) as last_played
               FROM cx_logs l
               JOIN cx_media m ON m.id=l.media_id
               LEFT JOIN cx_clients c ON c.id=m.client_id
               LEFT JOIN cx_playlist_items pi ON pi.media_id=m.id
               WHERE 1=1`;
    const params = [];

    if (req.query.client_id) {
      params.push(req.query.client_id);
      sql += ` AND m.client_id=$${params.length}`;
    }
    if (req.query.screen_id) {
      params.push(req.query.screen_id);
      sql += ` AND l.screen_id=$${params.length}`;
    }
    if (req.query.from) {
      params.push(req.query.from);
      sql += ` AND l.played_at >= $${params.length}`;
    }
    if (req.query.to) {
      params.push(req.query.to);
      sql += ` AND l.played_at < ($${params.length}::date + INTERVAL '1 day')`;
    }

    // Daily operating-hours filter. It also supports ranges crossing midnight
    // (for example 22:00 → 06:00).
    const startTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(req.query.start_time || ''))
      ? String(req.query.start_time)
      : null;
    const endTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(req.query.end_time || ''))
      ? String(req.query.end_time)
      : null;

    if (startTime && endTime) {
      params.push(startTime);
      const startRef = `$${params.length}`;
      params.push(endTime);
      const endRef = `$${params.length}`;

      if (startTime <= endTime) {
        sql += ` AND l.played_at::time >= ${startRef}::time AND l.played_at::time < ${endRef}::time`;
      } else {
        sql += ` AND (l.played_at::time >= ${startRef}::time OR l.played_at::time < ${endRef}::time)`;
      }
    }

    sql += ' GROUP BY m.id,m.title,m.media_type,m.thumbnail_name,c.name ORDER BY play_count DESC LIMIT 100';
    const r = await q(sql, params);
    res.json(r.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── HISTORY ─────────────────────────────────────────────────────────────────
app.get('/api/history', auth, async (req, res) => {
  const r = await q(`SELECT l.*,s.name as screen_name,m.title as media_title
                     FROM cx_logs l
                     LEFT JOIN cx_screens s ON s.id=l.screen_id
                     LEFT JOIN cx_media m ON m.id=l.media_id
                     ORDER BY l.played_at DESC LIMIT 500`);
  res.json(r.rows);
});

cxViewV3.register({app,q,auth,adminOnly,superOnly,notifyPlayer,notifyScreens,PUBLIC_BASE_URL,MEDIA_ROOT});
cxViewV28.register({ app, q, auth, adminOnly, notifyPlayer });
cxViewV29.register({ app, q, auth, notifyPlayer });
cxViewV30.register({ app, q, auth });
cxViewV32.register({ app, q, auth, adminOnly });
cxViewV33.register({ app, q, auth });
cxViewV34.register({ app, q, superOnly, MEDIA_ROOT, PUBLIC_BASE_URL, notifyPlayer });
cxViewV35.register({ app, q, PUBLIC_BASE_URL });
cxViewIntegrationsV1.register({ app, q, auth, adminOnly, notifyPlayer, MEDIA_ROOT, PUBLIC_BASE_URL });

// ─── API PLAYER ───────────────────────────────────────────────────────────────
app.get('/api/player/:code', async (req, res) => {
  try {
    const r = await q(`SELECT s.*,pa.name a_name,pb.name b_name
                       FROM cx_screens s
                       LEFT JOIN cx_playlists pa ON pa.id=s.playlist_a_id
                       LEFT JOIN cx_playlists pb ON pb.id=s.playlist_b_id
                       WHERE s.pairing_code=$1`, [req.params.code.toUpperCase()]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Code introuvable' });
    const screen = r.rows[0];
    await q(
      'UPDATE cx_screens SET last_seen_at=NOW(), player_version=COALESCE($1, player_version) WHERE id=$2',
      [String(req.query.player_version || '').trim() || null, screen.id]
    );
    const now = new Date();
    const dayMap = ['sun','mon','tue','wed','thu','fri','sat'];
    const today = dayMap[now.getDay()];
    const timeNow = now.toTimeString().substring(0,5);
    async function getZoneItems(playlistId) {
      if (!playlistId) return [];
      const items = await q(
        `SELECT pi.*,m.file_name,m.title,m.mime_type,m.media_type,m.thumbnail_name
         FROM cx_playlist_items pi
         LEFT JOIN cx_media m ON m.id=pi.media_id
         WHERE pi.playlist_id=$1 AND pi.active=true ORDER BY pi.position`, [playlistId]
      );
      return items.rows.filter(item => {
        if (item.schedule_start && new Date(item.schedule_start) > now) return false;
        if (item.schedule_end && new Date(item.schedule_end) < now) return false;
        if (item.schedule_days && item.schedule_days !== 'all') {
          if (!item.schedule_days.split(',').includes(today)) return false;
        }
        if (item.schedule_time_from && timeNow < item.schedule_time_from.substring(0,5)) return false;
        if (item.schedule_time_to && timeNow > item.schedule_time_to.substring(0,5)) return false;
        return true;
      }).map(item => ({
        render_mode: item.item_type === 'WIDGET' ? 'SLIDE' : 'MEDIA',
        ...item,
        url: item.file_name ? `${PUBLIC_BASE_URL}/files/uploads/${item.file_name}` : null,
        thumbnail_url: item.thumbnail_name ? `${PUBLIC_BASE_URL}/files/thumbs/${item.thumbnail_name}` : null
      }));
    }
    res.json({
      screen: { id: screen.id, name: screen.name, width: screen.width_px, height: screen.height_px,
        orientation: screen.orientation, layout: screen.layout, standby_color: screen.standby_color,
        display_mode: screen.display_mode || 'WINDOW', monitor_id: Number(screen.monitor_id || 0),
        player_window_mode: screen.player_window_mode || (screen.display_mode === 'KIOSK' ? 'FULLSCREEN' : 'WINDOW'),
        window: { x:Number(screen.window_x||0), y:Number(screen.window_y||0), width:Number(screen.window_width_px||screen.width_px), height:Number(screen.window_height_px||screen.height_px), corner_mode:screen.window_corner_mode||'SQUARE', corner_radius:Number(screen.window_corner_radius_px||0), always_on_top:screen.always_on_top!==false, hide_cursor:screen.hide_cursor!==false },
        zone_split_percent:Number(screen.zone_split_percent||50), zone_names:{ A:screen.zone_a_name||'Zone A', B:screen.zone_b_name||'Zone B' },
        zone_crops:{ A:{top:Number(screen.zone_a_crop_top||0),right:Number(screen.zone_a_crop_right||0),bottom:Number(screen.zone_a_crop_bottom||0),left:Number(screen.zone_a_crop_left||0),mode:screen.zone_a_crop_mode||'HIDE'}, B:{top:Number(screen.zone_b_crop_top||0),right:Number(screen.zone_b_crop_right||0),bottom:Number(screen.zone_b_crop_bottom||0),left:Number(screen.zone_b_crop_left||0),mode:screen.zone_b_crop_mode||'HIDE'} },
        player_ui:{ hover_controls:true, actions:['STOP','ECO','SETTINGS'] },
        sync_version: Number(screen.sync_version || 0) },
      zones: { A: await getZoneItems(screen.playlist_a_id), B: screen.layout !== 'SINGLE' ? await getZoneItems(screen.playlist_b_id) : [] }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ─── MISES À JOUR AUTOMATIQUES DU PLAYER ─────────────────────────────────────
function versionParts(value) {
  return String(value || '0').replace(/^v/i, '').split(/[.+-]/).slice(0, 3)
    .map(part => Number.parseInt(part, 10) || 0);
}
function isVersionNewer(candidate, current) {
  const a = versionParts(candidate), b = versionParts(current);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}
function playerDownloadUrl(req, code, updateId) {
  const origin = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
  return `${origin}/api/player/${encodeURIComponent(code)}/updates/${updateId}/download`;
}

app.get('/api/player-updates', superOnly, async (req, res) => {
  try {
    const result = await q(`SELECT id,version,original_name,file_size,sha256,notes,mandatory,published,published_at,created_at
                            FROM cx_player_updates ORDER BY published_at DESC NULLS LAST, created_at DESC`);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/player-updates', superOnly, playerUpdateUpload.single('installer'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Sélectionnez l’installateur Windows (.exe).' });
    const version = String(req.body.version || '').trim().replace(/^v/i, '');
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ error: 'Utilisez une version au format 6.5.2.' });
    }
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(req.file.path)).digest('hex');
    const result = await q(
      `INSERT INTO cx_player_updates(version,file_name,original_name,file_size,sha256,notes,mandatory,published,published_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,true,NOW()) RETURNING *`,
      [version, req.file.filename, req.file.originalname, req.file.size, sha256, String(req.body.notes || '').trim() || null,
       String(req.body.mandatory || '').toLowerCase() === 'true']
    );
    const screens = await q('SELECT pairing_code FROM cx_screens');
    for (const screen of screens.rows) {
      notifyPlayer(screen.pairing_code, { type: 'player-update', version: result.rows[0].version });
    }
    res.status(201).json({ ok: true, update: result.rows[0], notified_players: screens.rowCount });
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) { try { fs.unlinkSync(req.file.path); } catch (_) {} }
    res.status(500).json({ error: e.code === '23505' ? 'Cette version existe déjà.' : e.message });
  }
});

app.get('/api/player/:code/update', async (req, res) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase();
    const screen = await q('SELECT id FROM cx_screens WHERE pairing_code=$1', [code]);
    if (!screen.rows[0]) return res.status(404).json({ error: 'Code introuvable' });
    const release = await q(`SELECT id,version,sha256,file_size,notes,mandatory,published_at
                             FROM cx_player_updates WHERE published=true
                             ORDER BY published_at DESC NULLS LAST, id DESC LIMIT 1`);
    const update = release.rows[0];
    if (!update || !isVersionNewer(update.version, req.query.version)) {
      return res.json({ update: false });
    }
    res.json({
      update: true, id: update.id, version: update.version, sha256: update.sha256,
      size: Number(update.file_size || 0), notes: update.notes || '', mandatory: !!update.mandatory,
      url: playerDownloadUrl(req, code, update.id)
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/player/:code/updates/:id/download', async (req, res) => {
  try {
    const screen = await q('SELECT id FROM cx_screens WHERE pairing_code=$1', [String(req.params.code || '').trim().toUpperCase()]);
    if (!screen.rows[0]) return res.status(404).json({ error: 'Code introuvable' });
    const update = await q('SELECT file_name,original_name FROM cx_player_updates WHERE id=$1 AND published=true', [req.params.id]);
    if (!update.rows[0]) return res.status(404).json({ error: 'Mise à jour introuvable' });
    const filePath = path.join(PLAYER_UPDATES_ROOT, path.basename(update.rows[0].file_name));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Installateur indisponible' });
    res.download(filePath, update.rows[0].original_name || `cx-view-player-${req.params.id}.exe`);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/player/:code/log', express.json(), async (req, res) => {
  try {
    const r = await q('SELECT id FROM cx_screens WHERE pairing_code=$1', [req.params.code.toUpperCase()]);
    if (!r.rows[0]) return res.status(404).json({ error: 'Code introuvable' });
    await q('INSERT INTO cx_logs(screen_id,media_id,playlist_id,zone,event) VALUES($1,$2,$3,$4,$5)',
      [r.rows[0].id, req.body.media_id||null, req.body.playlist_id||null, req.body.zone||'A', req.body.event||'PLAYED']);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});


// ─── PUBLICATION DE PLAYLIST ─────────────────────────────────────────────────
app.post('/api/playlists/:id/publish', auth, async (req, res) => {
  try {
    const playlistId = Number(req.params.id);
    const screens = await q(
      `SELECT id,name,pairing_code FROM cx_screens
       WHERE playlist_a_id=$1 OR playlist_b_id=$1 ORDER BY name`,
      [playlistId]
    );
    await q(
      `UPDATE cx_screens SET sync_version=COALESCE(sync_version,0)+1
       WHERE playlist_a_id=$1 OR playlist_b_id=$1`,
      [playlistId]
    );
    notifyScreens(screens.rows);
    res.json({
      ok: true,
      playlist_id: playlistId,
      screens: screens.rows,
      realtime: true,
      message: screens.rows.length
        ? 'Playlist publiée et synchronisation instantanée envoyée.'
        : 'Playlist publiée, mais aucun écran ne lui est attribué.'
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});


// ─── RESET DES LOGS (SUPER ADMIN) ────────────────────────────────────────────
app.post('/api/logs/reset', auth, async (req, res) => {
  try {
    if (req.session.userRole !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Action réservée au Super Admin' });
    }
    const deleted = await q('DELETE FROM cx_logs RETURNING id');
    res.json({ ok: true, deleted: deleted.rowCount });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── DÉMARRAGE ────────────────────────────────────────────────────────────────
const httpServer = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

httpServer.on('upgrade', (request, socket, head) => {
  if (REBUILD_SAFE_MODE) {
    socket.destroy();
    return;
  }

  let url;
  try { url = new URL(request.url, 'http://localhost'); } catch (_) { socket.destroy(); return; }
  if (url.pathname !== '/ws/player') { socket.destroy(); return; }
  const code = String(url.searchParams.get('code') || '').trim().toUpperCase();
  if (!code) { socket.destroy(); return; }
  wss.handleUpgrade(request, socket, head, ws => {
    const previous = playerSockets.get(code);
    if (previous && previous !== ws) { try { previous.close(); } catch (_) {} }
    playerSockets.set(code, ws);
    ws.on('close', () => { if (playerSockets.get(code) === ws) playerSockets.delete(code); });
    ws.on('error', () => {});
    try { ws.send(JSON.stringify({ type: 'CONNECTED' })); } catch (_) {}
  });
});

httpServer.listen(PORT, () => console.log(`✅ CX-View Admin V1.5 Full Kiosk & Design démarré sur le port ${PORT}`));

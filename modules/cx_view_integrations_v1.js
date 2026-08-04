'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const PROVIDERS = Object.freeze({
  weather: { status: 'ACTIVE', category: 'DATA', label: 'Météo', player_data_route: '/api/player/:code/v2/widget-data?type=WEATHER' },
  rss: { status: 'ACTIVE', category: 'DATA', label: 'Flux RSS', player_data_route: '/api/player/:code/v2/widget-data?type=RSS' },
  traffic: { status: 'PLANNED', category: 'DATA', label: 'Trafic' },
  calendar: { status: 'PLANNED', category: 'DATA', label: 'Calendrier' },
  social: { status: 'PLANNED', category: 'SOCIAL', label: 'Réseaux sociaux' },
  qr_to_screen: { status: 'ACTIVE', category: 'INTERACTION', label: 'QR to Screen' },
  webhook: { status: 'PLANNED', category: 'AUTOMATION', label: 'Webhooks' },
  custom_api: { status: 'PLANNED', category: 'DEVELOPER', label: 'API personnalisée' }
});

function html(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function register({ app, q, auth, adminOnly, notifyPlayer, MEDIA_ROOT, PUBLIC_BASE_URL }) {
  const qrRoot = path.join(MEDIA_ROOT, 'qr-to-screen');
  fs.mkdirSync(qrRoot, { recursive: true });
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, qrRoot),
      filename: (_req, file, cb) => cb(null, `${Date.now()}-${crypto.randomBytes(10).toString('hex')}${path.extname(file.originalname || '').toLowerCase()}`)
    }),
    limits: { fileSize: 100 * 1024 * 1024, files: 1 },
    fileFilter: (_req, file, cb) => cb(null, /^(image|video)\//i.test(file.mimetype || ''))
  });
  const providerOr404 = (req, res) => {
    const key = String(req.params.provider || '').trim().toLowerCase();
    const provider = PROVIDERS[key];
    if (!provider) { res.status(404).json({ error: 'Intégration inconnue' }); return null; }
    return { key, ...provider };
  };
  const planned = (_req, res, provider, action) => res.status(501).json({ error: 'Intégration préparée mais pas encore activée', provider: provider.key, action, status: provider.status });

  app.get('/api/v2/integrations/catalog', auth, (_req, res) => res.json({ version: 2, integrations: Object.entries(PROVIDERS).map(([key, value]) => ({ key, ...value })) }));
  app.get('/api/v2/integrations/:provider', auth, (req, res) => { const p = providerOr404(req,res); if(p) res.json(p); });
  app.get('/api/v2/integrations/:provider/config', auth, (req, res) => { const p=providerOr404(req,res); if(!p)return; if(p.key==='qr_to_screen')return res.json({active:true,session_minutes:15,max_file_mb:100,accepted:['image/*','video/*']}); planned(req,res,p,'READ_CONFIG'); });
  app.put('/api/v2/integrations/:provider/config', adminOnly, (req,res)=>{const p=providerOr404(req,res);if(!p)return;planned(req,res,p,'WRITE_CONFIG');});
  app.post('/api/v2/integrations/:provider/test', adminOnly, (req,res)=>{const p=providerOr404(req,res);if(!p)return;if(p.key==='qr_to_screen')return res.json({ok:true,status:'ACTIVE'});planned(req,res,p,'TEST');});

  app.post('/api/v2/integrations/qr_to_screen/session', adminOnly, async (req, res) => {
    res.set('Cache-Control','no-store');
    try {
      const screenId = Number(req.body.screen_id);
      const screen = (await q('SELECT id,name,pairing_code FROM cx_screens WHERE id=$1',[screenId])).rows[0];
      if (!screen) return res.status(404).json({error:'Écran introuvable'});
      const token = crypto.randomBytes(24).toString('hex');
      const minutes = Math.max(1, Math.min(1440, Number(req.body.minutes || 15)));
      const duration = Math.max(5, Math.min(600, Number(req.body.duration_seconds || 30)));
      await q(`INSERT INTO cx_qr_sessions(token,screen_id,expires_at,duration_seconds,max_uses)
               VALUES($1,$2,NOW()+($3::text || ' minutes')::interval,$4,$5)`,[token,screen.id,minutes,duration,Math.max(1,Math.min(500,Number(req.body.max_uses||20)))]);
      const origin = PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
      res.json({ok:true,token,screen:{id:screen.id,name:screen.name},url:`${origin}/qr-to-screen/${token}`,expires_in_minutes:minutes,duration_seconds:duration,max_uses:Math.max(1,Math.min(500,Number(req.body.max_uses||20)))});
    } catch (error) { res.status(500).json({error:error.message}); }
  });

  app.get('/qr-to-screen/:token', async (req,res)=>{
    res.set('Cache-Control','no-store');
    const session=(await q(`SELECT qs.*,s.name screen_name FROM cx_qr_sessions qs JOIN cx_screens s ON s.id=qs.screen_id WHERE qs.token=$1`,[req.params.token])).rows[0];
    if(!session || new Date(session.expires_at)<=new Date() || Number(session.use_count)>=Number(session.max_uses)) return res.status(410).type('html').send('<h2>Ce lien QR est expiré.</h2>');
    res.type('html').send(`<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Envoyer à ${html(session.screen_name)}</title><style>body{font-family:system-ui;background:#0b1020;color:#fff;margin:0;padding:24px}.card{max-width:560px;margin:7vh auto;background:#151c31;padding:26px;border-radius:18px}input,button{width:100%;padding:15px;border-radius:10px;border:0;margin-top:12px}input{background:#fff;color:#111}button{background:#6d5dfc;color:#fff;font-weight:700;font-size:16px}.hint{color:#aeb8d4;font-size:14px}</style><div class="card"><h1>Envoyer sur l’écran</h1><p>Destination : <b>${html(session.screen_name)}</b></p><form method="post" action="/qr-to-screen/${html(req.params.token)}/send" enctype="multipart/form-data"><input type="file" name="media" accept="image/*,video/*" required><button>Afficher maintenant</button></form><p class="hint">Image ou vidéo · 100 Mo maximum · affichage temporaire de ${Number(session.duration_seconds)} secondes.</p></div></html>`);
  });

  app.post('/qr-to-screen/:token/send', upload.single('media'), async (req,res)=>{
    res.set('Cache-Control','no-store');
    try {
      const session=(await q(`SELECT qs.*,s.pairing_code,s.name screen_name FROM cx_qr_sessions qs JOIN cx_screens s ON s.id=qs.screen_id WHERE qs.token=$1 FOR UPDATE`,[req.params.token])).rows[0];
      if(!session || new Date(session.expires_at)<=new Date() || Number(session.use_count)>=Number(session.max_uses)) { if(req.file)fs.rmSync(req.file.path,{force:true}); return res.status(410).send('Lien expiré.'); }
      if(!req.file) return res.status(400).send('Fichier image ou vidéo requis.');
      const origin=PUBLIC_BASE_URL||`${req.protocol}://${req.get('host')}`;
      const payload={url:`${origin}/files/qr-to-screen/${encodeURIComponent(req.file.filename)}`,mime_type:req.file.mimetype,file_name:req.file.filename,original_name:req.file.originalname,duration_seconds:Number(session.duration_seconds||30)};
      const cmd=(await q(`INSERT INTO cx_player_commands(screen_id,type,payload,status,source_type,source_id)
        VALUES($1,'QR_TO_SCREEN',$2::jsonb,'PENDING','QR_SESSION',NULL) RETURNING id`,[session.screen_id,JSON.stringify(payload)])).rows[0];
      await q('UPDATE cx_qr_sessions SET use_count=use_count+1,last_used_at=NOW() WHERE token=$1',[req.params.token]);
      notifyPlayer(session.pairing_code,{type:'command',commandId:cmd.id,command:'QR_TO_SCREEN'});
      res.type('html').send(`<!doctype html><html lang="fr"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;background:#0b1020;color:#fff;text-align:center;padding:70px 24px}a{color:#a99cff}</style><h1>✓ Envoyé</h1><p>Le contenu va apparaître sur <b>${html(session.screen_name)}</b>.</p><p><a href="/qr-to-screen/${html(req.params.token)}">Envoyer un autre contenu</a></p></html>`);
    } catch(error) { if(req.file)fs.rmSync(req.file.path,{force:true}); res.status(500).send(html(error.message)); }
  });

  app.get('/api/player/:code/v2/integrations', async (req,res)=>{try{const screen=await q('SELECT id FROM cx_screens WHERE pairing_code=$1',[String(req.params.code||'').trim().toUpperCase()]);if(!screen.rows[0])return res.status(404).json({error:'Code introuvable'});res.json({version:2,integrations:Object.entries(PROVIDERS).map(([key,value])=>({key,status:value.status}))});}catch(error){res.status(500).json({error:error.message});}});
}
module.exports={register,PROVIDERS};

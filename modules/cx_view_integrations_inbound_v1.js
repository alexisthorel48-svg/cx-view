'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 5000;
const MAX_INBOUND_MEDIA_BYTES = 100 * 1024 * 1024; // canal moins fiable qu'un upload admin -> plafond plus strict que les 500 Mo habituels

const hashKey = key => crypto.createHash('sha256').update(String(key)).digest('hex');
const genKey = () => 'cxv_' + crypto.randomBytes(24).toString('hex');
const taskView = t => ({ id: t.id, external_task_id: t.external_task_id, type: t.type, status: t.status, result: t.result, error_message: t.error_message, created_at: t.created_at, updated_at: t.updated_at });

const EXT_BY_CONTENT_TYPE = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'video/webm': '.webm'
};

function register({ app, q, adminOnly, MEDIA_ROOT }) {
  fs.mkdirSync(path.join(MEDIA_ROOT, 'uploads'), { recursive: true });
  fs.mkdirSync(path.join(MEDIA_ROOT, 'thumbs'), { recursive: true });

  async function integrationAuth(req, res, next) {
    const h = String(req.headers.authorization || '');
    const key = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    if (!key) return res.status(401).json({ error: 'Clé API manquante' });
    const client = (await q('SELECT * FROM cx_integration_clients WHERE api_key_hash=$1 AND active=true', [hashKey(key)])).rows[0];
    if (!client) return res.status(401).json({ error: 'Clé API invalide' });
    q('UPDATE cx_integration_clients SET last_used_at=NOW() WHERE id=$1', [client.id]).catch(() => {});
    req.integrationClient = client;
    next();
  }

  // --- Handlers métier. CX Commerce / CX One doivent se mettre d'accord avec CX View sur le
  // format de `payload` de chaque type avant qu'un handler soit ajouté ici — un type non
  // enregistré est refusé proprement (tâche FAILED) plutôt que de planter le worker. ---
  const HANDLERS = {
    PING: async payload => ({ pong: true, echoed: payload || null }),

    // Récupère un média (image ou courte vidéo) depuis une URL fournie par l'appelant et
    // l'ajoute à la médiathèque, scopé au client/dossier configurés pour cette clé API —
    // jamais une valeur venant du payload, pour garantir l'isolation entre intégrations.
    MEDIA_UPLOAD: async (payload, task) => {
      const client = (await q('SELECT default_client_id,default_folder_id FROM cx_integration_clients WHERE id=$1', [task.client_id])).rows[0];
      const url = String(payload.media_url || '').trim();
      if (!/^https?:\/\//i.test(url)) throw new Error('media_url invalide ou manquant');

      const response = await fetch(url);
      if (!response.ok) throw new Error(`Téléchargement impossible (HTTP ${response.status})`);
      const contentType = String(response.headers.get('content-type') || payload.mime_type || '').split(';')[0].trim().toLowerCase();
      const isImage = contentType.startsWith('image/'), isVideo = contentType.startsWith('video/');
      if (!isImage && !isVideo) throw new Error(`Type de fichier non supporté : ${contentType || 'inconnu'}`);
      const declaredLength = Number(response.headers.get('content-length') || 0);
      if (declaredLength > MAX_INBOUND_MEDIA_BYTES) throw new Error(`Fichier trop volumineux (${Math.round(declaredLength / 1024 / 1024)} Mo, max ${MAX_INBOUND_MEDIA_BYTES / 1024 / 1024} Mo)`);

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_INBOUND_MEDIA_BYTES) throw new Error(`Fichier trop volumineux (${Math.round(buffer.length / 1024 / 1024)} Mo, max ${MAX_INBOUND_MEDIA_BYTES / 1024 / 1024} Mo)`);

      let inferredExt = '';
      try { inferredExt = path.extname(new URL(url).pathname); } catch (_) {}
      const ext = EXT_BY_CONTENT_TYPE[contentType] || inferredExt || (isVideo ? '.mp4' : '.jpg');
      const fileName = crypto.randomUUID() + ext;
      const filePath = path.join(MEDIA_ROOT, 'uploads', fileName);
      fs.writeFileSync(filePath, buffer);

      let thumbName = null;
      try {
        if (isImage) {
          const sharp = require('sharp');
          thumbName = 'thumb_' + fileName + '.jpg';
          await sharp(filePath).resize(320, 180, { fit: 'cover' }).jpeg({ quality: 80 }).toFile(path.join(MEDIA_ROOT, 'thumbs', thumbName));
        } else {
          const ffmpeg = require('fluent-ffmpeg');
          thumbName = 'thumb_' + fileName + '.jpg';
          await new Promise((resolve, reject) => {
            ffmpeg(filePath).screenshots({ count: 1, folder: path.join(MEDIA_ROOT, 'thumbs'), filename: thumbName, size: '320x180' }).on('end', resolve).on('error', reject);
          });
        }
      } catch (_) { thumbName = null; }

      const title = String(payload.title || '').trim() || path.parse(fileName).name;
      const media = (await q(
        `INSERT INTO cx_media(client_id,folder_id,title,file_name,original_name,mime_type,media_type,bytes,thumbnail_name)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [client?.default_client_id || null, client?.default_folder_id || null, title, fileName, fileName, contentType, isVideo ? 'VIDEO' : 'IMAGE', buffer.length, thumbName]
      )).rows[0];
      return { media_id: media.id };
    },

    // Associe un média déjà envoyé à une playlist autorisée. `repeat_count>1` insère le média
    // plusieurs fois, réparti le plus loin possible dans la rotation existante — distinct du
    // mécanisme is_priority/priority_interval_minutes (réservé aux interstitiels programmés
    // ailleurs dans l'app), volontairement pas réutilisé ici.
    PLAYLIST_SCHEDULE: async (payload, task) => {
      const client = (await q('SELECT default_client_id,allowed_playlist_ids FROM cx_integration_clients WHERE id=$1', [task.client_id])).rows[0];
      const mediaId = Number(payload.media_id), playlistId = Number(payload.playlist_id);
      if (!mediaId) throw new Error('media_id requis');
      if (!playlistId) throw new Error('playlist_id requis');
      if (!(client?.allowed_playlist_ids || []).map(Number).includes(playlistId)) throw new Error('Playlist non autorisée pour ce client');

      const media = (await q('SELECT id,client_id FROM cx_media WHERE id=$1', [mediaId])).rows[0];
      if (!media) throw new Error('Média introuvable');
      if (client?.default_client_id != null && Number(media.client_id) !== Number(client.default_client_id)) throw new Error('Média non autorisé pour ce client');

      const repeatCount = Math.max(1, Math.min(10, Number(payload.repeat_count) || 1));
      const duration = Math.max(1, Number(payload.duration_seconds) || 10);
      const existing = (await q('SELECT id FROM cx_playlist_items WHERE playlist_id=$1 ORDER BY position ASC,id ASC', [playlistId])).rows;
      const existingCount = existing.length;

      // Une seule occurrence : ajoutée en fin de rotation, comme toute autre méthode d'ajout
      // dans l'app. Plusieurs occurrences : réparties entre les médias existants (segments
      // internes, jamais collées au tout début ni à la toute fin) pour maximiser l'espacement —
      // calculé une fois au moment de l'insertion, pas recalculé dynamiquement après coup.
      const sequence = existing.map(e => ({ id: e.id }));
      if (repeatCount === 1) {
        sequence.push({ new: true });
      } else {
        for (let i = repeatCount - 1; i >= 0; i--) {
          const at = Math.round((i + 1) * existingCount / (repeatCount + 1));
          sequence.splice(at, 0, { new: true });
        }
      }

      const insertedIds = [];
      for (const slot of sequence) {
        if (!slot.new) continue;
        const r = await q(
          `INSERT INTO cx_playlist_items(playlist_id,item_type,media_id,position,duration_seconds,schedule_start,schedule_end,schedule_days,is_priority,priority_count,widget_config)
           VALUES($1,'MEDIA',$2,0,$3,$4,$5,'all',false,1,'{}') RETURNING id`,
          [playlistId, mediaId, duration, payload.starts_at || null, payload.ends_at || null]
        );
        slot.id = r.rows[0].id;
        insertedIds.push(r.rows[0].id);
      }
      for (let i = 0; i < sequence.length; i++) {
        await q('UPDATE cx_playlist_items SET position=$1 WHERE id=$2 AND playlist_id=$3', [i, sequence[i].id, playlistId]);
      }
      return { playlist_item_ids: insertedIds };
    }
  };

  // --- Réception de tâches (CX Commerce / CX One -> CX View) ---
  app.post('/api/integrations/inbound/v1/tasks', integrationAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const externalId = String(req.body.external_task_id || '').trim();
    const type = String(req.body.type || '').trim().toUpperCase();
    const payload = req.body.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
    if (!externalId) return res.status(400).json({ error: 'external_task_id requis' });
    if (!type) return res.status(400).json({ error: 'type requis' });
    try {
      const existing = (await q('SELECT * FROM cx_integration_tasks WHERE client_id=$1 AND type=$2 AND external_task_id=$3', [req.integrationClient.id, type, externalId])).rows[0];
      if (existing) return res.status(200).json({ ok: true, idempotent: true, task: taskView(existing) });

      if (!HANDLERS[type]) {
        const failed = (await q(`INSERT INTO cx_integration_tasks(client_id,external_task_id,type,payload,status,error_message)
          VALUES($1,$2,$3,$4::jsonb,'FAILED',$5) RETURNING *`,
          [req.integrationClient.id, externalId, type, JSON.stringify(payload), `Type de tâche inconnu: ${type}`])).rows[0];
        return res.status(202).json({ ok: true, task: taskView(failed) });
      }

      const created = (await q(`INSERT INTO cx_integration_tasks(client_id,external_task_id,type,payload)
        VALUES($1,$2,$3,$4::jsonb) RETURNING *`, [req.integrationClient.id, externalId, type, JSON.stringify(payload)])).rows[0];
      res.status(202).json({ ok: true, task: taskView(created) });
    } catch (error) {
      if (error.code === '23505') {
        const existing = (await q('SELECT * FROM cx_integration_tasks WHERE client_id=$1 AND type=$2 AND external_task_id=$3', [req.integrationClient.id, type, externalId])).rows[0];
        if (existing) return res.status(200).json({ ok: true, idempotent: true, task: taskView(existing) });
      }
      res.status(500).json({ error: error.message });
    }
  });

  // Lecture de statut par référence externe (nécessite le type, désormais partie de la clé
  // d'idempotence) ou par identifiant média CX View (recherché dans le résultat de la tâche).
  app.get('/api/integrations/inbound/v1/tasks', integrationAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const externalId = String(req.query.external_task_id || '').trim();
    const type = String(req.query.type || '').trim().toUpperCase();
    const mediaId = req.query.media_id ? Number(req.query.media_id) : null;
    let task;
    if (mediaId) {
      task = (await q(`SELECT * FROM cx_integration_tasks WHERE client_id=$1 AND result->>'media_id'=$2 ORDER BY created_at DESC LIMIT 1`, [req.integrationClient.id, String(mediaId)])).rows[0];
    } else if (externalId && type) {
      task = (await q('SELECT * FROM cx_integration_tasks WHERE client_id=$1 AND type=$2 AND external_task_id=$3', [req.integrationClient.id, type, externalId])).rows[0];
    } else {
      return res.status(400).json({ error: 'Fournir soit media_id, soit external_task_id + type' });
    }
    if (!task) return res.status(404).json({ error: 'Tâche introuvable' });
    res.json({ ok: true, task: taskView(task) });
  });

  app.get('/api/integrations/inbound/v1/tasks/:id', integrationAuth, async (req, res) => {
    const task = (await q('SELECT * FROM cx_integration_tasks WHERE id=$1 AND client_id=$2', [Number(req.params.id), req.integrationClient.id])).rows[0];
    if (!task) return res.status(404).json({ error: 'Tâche introuvable' });
    res.json({ ok: true, task: taskView(task) });
  });

  // --- Administration des clients d'intégration (clés API) ---
  app.get('/api/v2/integrations/inbound/clients', adminOnly, async (_req, res) => {
    const rows = (await q('SELECT id,name,active,created_at,last_used_at,default_client_id,default_folder_id,allowed_playlist_ids FROM cx_integration_clients ORDER BY created_at DESC')).rows;
    res.json({ ok: true, clients: rows });
  });
  app.post('/api/v2/integrations/inbound/clients', adminOnly, async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nom requis' });
    const key = genKey();
    const allowedPlaylistIds = Array.isArray(req.body.allowed_playlist_ids) ? req.body.allowed_playlist_ids.map(Number).filter(Boolean) : [];
    const created = (await q(
      `INSERT INTO cx_integration_clients(name,api_key_hash,default_client_id,default_folder_id,allowed_playlist_ids)
       VALUES($1,$2,$3,$4,$5) RETURNING id,name,active,created_at,default_client_id,default_folder_id,allowed_playlist_ids`,
      [name, hashKey(key), req.body.default_client_id || null, req.body.default_folder_id || null, allowedPlaylistIds]
    )).rows[0];
    res.status(201).json({ ok: true, client: created, api_key: key });
  });
  app.put('/api/v2/integrations/inbound/clients/:id/scope', adminOnly, async (req, res) => {
    const allowedPlaylistIds = Array.isArray(req.body.allowed_playlist_ids) ? req.body.allowed_playlist_ids.map(Number).filter(Boolean) : [];
    const updated = (await q(
      `UPDATE cx_integration_clients SET default_client_id=$1,default_folder_id=$2,allowed_playlist_ids=$3 WHERE id=$4
       RETURNING id,name,active,default_client_id,default_folder_id,allowed_playlist_ids`,
      [req.body.default_client_id || null, req.body.default_folder_id || null, allowedPlaylistIds, Number(req.params.id)]
    )).rows[0];
    if (!updated) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ ok: true, client: updated });
  });
  app.post('/api/v2/integrations/inbound/clients/:id/revoke', adminOnly, async (req, res) => {
    const updated = (await q('UPDATE cx_integration_clients SET active=false WHERE id=$1 RETURNING id,name,active', [Number(req.params.id)])).rows[0];
    if (!updated) return res.status(404).json({ error: 'Client introuvable' });
    res.json({ ok: true, client: updated });
  });

  // --- Worker asynchrone : traite la file plutôt que de bloquer la requête entrante ---
  async function processPendingTasks() {
    let claimed;
    try {
      claimed = (await q(`UPDATE cx_integration_tasks SET status='PROCESSING', updated_at=NOW()
        WHERE id IN (SELECT id FROM cx_integration_tasks WHERE status='PENDING' ORDER BY created_at LIMIT 5 FOR UPDATE SKIP LOCKED)
        RETURNING *`)).rows;
    } catch (_) { return; }
    for (const task of claimed) {
      try {
        const handler = HANDLERS[task.type];
        if (!handler) throw new Error(`Type de tâche inconnu: ${task.type}`);
        const result = await handler(task.payload, task);
        await q(`UPDATE cx_integration_tasks SET status='DONE', result=$2::jsonb, error_message=NULL, updated_at=NOW() WHERE id=$1`, [task.id, JSON.stringify(result || {})]);
      } catch (error) {
        const attempts = task.attempts + 1;
        const permanent = attempts >= MAX_ATTEMPTS;
        await q(`UPDATE cx_integration_tasks SET status=$2, attempts=$3, error_message=$4, updated_at=NOW() WHERE id=$1`,
          [task.id, permanent ? 'FAILED' : 'PENDING', attempts, String(error.message || error)]);
      }
    }
  }
  setInterval(processPendingTasks, POLL_INTERVAL_MS);
  setTimeout(processPendingTasks, 3000);
}

module.exports = { register };

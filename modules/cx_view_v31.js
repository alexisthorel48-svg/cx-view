const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');

function safeName(value) {
  return String(value || '').trim().replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 180);
}
function roleClient(req) {
  return req.session && req.session.userRole === 'CLIENT' ? Number(req.session.clientId) : null;
}
function dayKey(date = new Date()) {
  return ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][date.getDay()];
}
function ruleMatches(rule, now = new Date()) {
  const date = now.toISOString().slice(0, 10);
  const time = now.toTimeString().slice(0, 5);
  if (!rule.active) return false;
  if (rule.start_date && String(rule.start_date).slice(0, 10) > date) return false;
  if (rule.end_date && String(rule.end_date).slice(0, 10) < date) return false;
  if (rule.days && rule.days !== 'all' && !String(rule.days).split(',').includes(dayKey(now))) return false;
  if (rule.time_from && rule.time_to) {
    const from = String(rule.time_from).slice(0, 5);
    const to = String(rule.time_to).slice(0, 5);
    return from <= to ? time >= from && time < to : (time >= from || time < to);
  }
  return true;
}

module.exports = {
  register({ app, q, auth, adminOnly, notifyPlayer, notifyScreens, MEDIA_ROOT }) {
    const uploadRoot = path.join(MEDIA_ROOT, 'uploads');
    fs.mkdirSync(uploadRoot, { recursive: true });

    const storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, uploadRoot),
      filename: (_req, file, cb) => cb(null, crypto.randomUUID() + path.extname(file.originalname).toLowerCase())
    });
    const upload = multer({ storage, limits: { fileSize: 500 * 1024 * 1024, files: 300 } });

    async function folderRow(id) {
      const result = await q('SELECT * FROM cx_folders WHERE id=$1', [id]);
      return result.rows[0] || null;
    }
    async function scopedFolder(req, folderId) {
      const folder = await folderRow(folderId);
      if (!folder) return null;
      const clientId = roleClient(req);
      return clientId && Number(folder.client_id) !== clientId ? null : folder;
    }
    async function rebuildPath(id) {
      const folder = await folderRow(id);
      if (!folder) return;
      const parent = folder.parent_id ? await folderRow(folder.parent_id) : null;
      const next = parent ? `${parent.path}/${folder.name}` : folder.name;
      await q('UPDATE cx_folders SET path=$1 WHERE id=$2', [next, id]);
      const children = await q('SELECT id FROM cx_folders WHERE parent_id=$1', [id]);
      for (const child of children.rows) await rebuildPath(child.id);
    }
    async function ensureFolder(parentId, clientId, name) {
      const clean = safeName(name);
      if (!clean) return parentId;
      const existing = await q(
        `SELECT * FROM cx_folders
         WHERE parent_id IS NOT DISTINCT FROM $1 AND client_id IS NOT DISTINCT FROM $2 AND name=$3
         LIMIT 1`,
        [parentId || null, clientId || null, clean]
      );
      if (existing.rows[0]) return existing.rows[0].id;
      const parent = parentId ? await folderRow(parentId) : null;
      const created = await q(
        'INSERT INTO cx_folders(name,client_id,parent_id,path) VALUES($1,$2,$3,$4) RETURNING id',
        [clean, clientId || null, parentId || null, parent ? `${parent.path}/${clean}` : clean]
      );
      return created.rows[0].id;
    }

    // ── Explorer de dossiers ─────────────────────────────────────────────────
    app.get('/api/v31/folders', auth, async (req, res) => {
      try {
        const clientId = roleClient(req);
        const query = clientId
          ? await q('SELECT * FROM cx_folders WHERE client_id=$1 ORDER BY path NULLS FIRST,name', [clientId])
          : await q(`SELECT f.*,c.name client_name FROM cx_folders f
                     LEFT JOIN cx_clients c ON c.id=f.client_id ORDER BY f.path NULLS FIRST,f.name`);
        res.json(query.rows);
      } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.post('/api/v31/folders', adminOnly, async (req, res) => {
      try {
        const parentId = req.body.parent_id ? Number(req.body.parent_id) : null;
        const parent = parentId ? await folderRow(parentId) : null;
        if (parentId && !parent) return res.status(404).json({ error: 'Dossier parent introuvable.' });
        const clientId = parent ? parent.client_id : (req.body.client_id ? Number(req.body.client_id) : null);
        const id = await ensureFolder(parentId, clientId, req.body.name);
        const folder = await folderRow(id);
        res.status(201).json(folder);
      } catch (error) { res.status(400).json({ error: error.message }); }
    });

    app.put('/api/v31/folders/:id', adminOnly, async (req, res) => {
      try {
        const folder = await folderRow(req.params.id);
        if (!folder) return res.status(404).json({ error: 'Dossier introuvable.' });
        const name = safeName(req.body.name || folder.name);
        await q('UPDATE cx_folders SET name=$1 WHERE id=$2', [name, folder.id]);
        await rebuildPath(folder.id);
        res.json(await folderRow(folder.id));
      } catch (error) { res.status(400).json({ error: error.message }); }
    });

    app.delete('/api/v31/folders/:id', adminOnly, async (req, res) => {
      try {
        const count = await q(`WITH RECURSIVE tree AS (
          SELECT id FROM cx_folders WHERE id=$1
          UNION ALL SELECT f.id FROM cx_folders f JOIN tree t ON f.parent_id=t.id
        ) SELECT COUNT(*)::int count FROM cx_media WHERE folder_id IN (SELECT id FROM tree)`, [req.params.id]);
        if (Number(count.rows[0].count) > 0) return res.status(409).json({ error: 'Déplacez ou supprimez les médias avant de supprimer ce dossier.' });
        await q('DELETE FROM cx_folders WHERE id=$1', [req.params.id]);
        res.json({ ok: true });
      } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.get('/api/v31/media', auth, async (req, res) => {
      try {
        const clientId = roleClient(req);
        const folderId = req.query.folder_id ? Number(req.query.folder_id) : null;
        const params = [];
        let sql = `SELECT m.*,f.path folder_path,f.name folder_name,c.name client_name
                   FROM cx_media m
                   LEFT JOIN cx_folders f ON f.id=m.folder_id
                   LEFT JOIN cx_clients c ON c.id=m.client_id
                   WHERE m.status != 'PENDING_DELETE'`;
        if (clientId) { params.push(clientId); sql += ` AND m.client_id=$${params.length}`; }
        if (folderId) {
          const folder = await scopedFolder(req, folderId);
          if (!folder) return res.status(404).json({ error: 'Dossier introuvable.' });
          params.push(folderId);
          sql += ` AND m.folder_id IN (
            WITH RECURSIVE tree AS (
              SELECT id FROM cx_folders WHERE id=$${params.length}
              UNION ALL SELECT f2.id FROM cx_folders f2 JOIN tree t ON f2.parent_id=t.id
            ) SELECT id FROM tree
          )`;
        }
        if (req.query.search) { params.push('%' + req.query.search + '%'); sql += ` AND m.title ILIKE $${params.length}`; }
        sql += ' ORDER BY m.created_at DESC';
        res.json((await q(sql, params)).rows);
      } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.post('/api/v31/media/upload', adminOnly, upload.array('files', 300), async (req, res) => {
      const imported = [], failed = [];
      try {
        const rootFolder = req.body.folder_id ? await folderRow(Number(req.body.folder_id)) : null;
        if (!rootFolder) return res.status(400).json({ error: 'Sélectionnez un dossier de destination.' });
        const paths = JSON.parse(req.body.relative_paths || '[]');
        for (let index = 0; index < req.files.length; index++) {
          const file = req.files[index];
          try {
            const rel = String(paths[index] || file.originalname).replace(/\\/g, '/').split('/').filter(Boolean);
            let target = rootFolder.id;
            const folders = rel.slice(0, -1);
            for (const part of folders) target = await ensureFolder(target, rootFolder.client_id, part);
            const type = file.mimetype && file.mimetype.startsWith('video/') ? 'VIDEO' : 'IMAGE';
            const result = await q(
              `INSERT INTO cx_media(client_id,folder_id,title,file_name,original_name,mime_type,media_type,bytes)
               VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
              [rootFolder.client_id, target, path.parse(file.originalname).name, file.filename,
               file.originalname, file.mimetype, type, file.size]
            );
            imported.push(result.rows[0]);
          } catch (error) { failed.push({ name: file.originalname, error: error.message }); }
        }
        res.status(201).json({ ok: true, imported, failed });
      } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.post('/api/v31/media/move', adminOnly, async (req, res) => {
      try {
        const ids = (req.body.media_ids || []).map(Number).filter(Boolean);
        const folder = await folderRow(req.body.folder_id);
        if (!ids.length || !folder) return res.status(400).json({ error: 'Médias ou dossier invalides.' });
        await q('UPDATE cx_media SET folder_id=$1,client_id=$2 WHERE id=ANY($3::int[])', [folder.id, folder.client_id, ids]);
        res.json({ ok: true, count: ids.length });
      } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // ── Classement réel des écrans ────────────────────────────────────────────
    app.get('/api/v31/groups', auth, async (req, res) => {
      try {
        const clientId = roleClient(req);
        const params = [];
        let sql = `SELECT g.*,c.name client_name,COUNT(s.id)::int screen_count
                   FROM cx_screen_groups g
                   LEFT JOIN cx_clients c ON c.id=g.client_id
                   LEFT JOIN cx_screens s ON s.group_id=g.id`;
        if (clientId) { params.push(clientId); sql += ` WHERE g.client_id=$${params.length}`; }
        sql += ' GROUP BY g.id,c.name ORDER BY g.name';
        res.json((await q(sql, params)).rows);
      } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.post('/api/v31/groups', adminOnly, async (req, res) => {
      try {
        const parent = req.body.parent_id ? await q('SELECT * FROM cx_screen_groups WHERE id=$1', [req.body.parent_id]) : { rows: [null] };
        const clientId = parent.rows[0] ? parent.rows[0].client_id : (req.body.client_id || null);
        const result = await q(
          'INSERT INTO cx_screen_groups(name,client_id,parent_id) VALUES($1,$2,$3) RETURNING *',
          [safeName(req.body.name), clientId, req.body.parent_id || null]
        );
        res.status(201).json(result.rows[0]);
      } catch (error) { res.status(400).json({ error: error.message }); }
    });

    app.get('/api/v31/screens', auth, async (req, res) => {
      try {
        const clientId = roleClient(req);
        const params = [];
        let sql = `SELECT s.*,c.name client_name,g.name group_name,
                  pa.name playlist_a_name,pb.name playlist_b_name
                  FROM cx_screens s
                  LEFT JOIN cx_clients c ON c.id=s.client_id
                  LEFT JOIN cx_screen_groups g ON g.id=s.group_id
                  LEFT JOIN cx_playlists pa ON pa.id=s.playlist_a_id
                  LEFT JOIN cx_playlists pb ON pb.id=s.playlist_b_id WHERE 1=1`;
        if (clientId) { params.push(clientId); sql += ` AND s.client_id=$${params.length}`; }
        if (req.query.group_id) { params.push(Number(req.query.group_id)); sql += ` AND s.group_id=$${params.length}`; }
        if (req.query.search) {
          params.push('%' + req.query.search + '%');
          sql += ` AND (s.name ILIKE $${params.length} OR s.pairing_code ILIKE $${params.length} OR c.name ILIKE $${params.length} OR g.name ILIKE $${params.length})`;
        }
        sql += ' ORDER BY c.name NULLS FIRST,g.name NULLS FIRST,s.name';
        res.json((await q(sql, params)).rows);
      } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.put('/api/v31/screens/:id/group', adminOnly, async (req, res) => {
      try {
        const groupId = req.body.group_id || null;
        const updated = await q(`UPDATE cx_screens SET group_id=$1,sync_version=COALESCE(sync_version,0)+1
                                 WHERE id=$2 RETURNING pairing_code`, [groupId, req.params.id]);
        if (!updated.rows[0]) return res.status(404).json({ error: 'Écran introuvable.' });
        notifyPlayer(updated.rows[0].pairing_code, { type: 'sync' });
        res.json({ ok: true });
      } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // ── Règles de programmation réellement exploitables ───────────────────────
    app.get('/api/v31/screens/:id/rules', auth, async (req, res) => {
      try {
        const result = await q(`SELECT r.*,p.name playlist_name
          FROM cx_screen_schedule_rules r JOIN cx_playlists p ON p.id=r.playlist_id
          WHERE r.screen_id=$1 ORDER BY r.zone,r.priority DESC,r.id DESC`, [req.params.id]);
        res.json(result.rows);
      } catch (error) { res.status(500).json({ error: error.message }); }
    });

    app.post('/api/v31/screens/:id/rules', adminOnly, async (req, res) => {
      try {
        const b = req.body;
        if (!['A','B'].includes(b.zone)) return res.status(400).json({ error: 'Zone invalide.' });
        const result = await q(
          `INSERT INTO cx_screen_schedule_rules(screen_id,zone,playlist_id,name,priority,active,start_date,end_date,days,time_from,time_to)
           VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [req.params.id,b.zone,Number(b.playlist_id),safeName(b.name || 'Règle de programmation'),
           Number(b.priority || 100),b.active !== false,b.start_date || null,b.end_date || null,
           b.days || 'all',b.time_from || null,b.time_to || null]
        );
        const screen = await q(`UPDATE cx_screens SET sync_version=COALESCE(sync_version,0)+1
                                WHERE id=$1 RETURNING pairing_code`, [req.params.id]);
        notifyPlayer(screen.rows[0]?.pairing_code, { type: 'sync' });
        res.status(201).json(result.rows[0]);
      } catch (error) { res.status(400).json({ error: error.message }); }
    });

    app.put('/api/v31/rules/:id', adminOnly, async (req, res) => {
      try {
        const b = req.body;
        const result = await q(`UPDATE cx_screen_schedule_rules SET
          name=$1,priority=$2,active=$3,start_date=$4,end_date=$5,days=$6,time_from=$7,time_to=$8,playlist_id=$9,zone=$10
          WHERE id=$11 RETURNING screen_id,*`,
          [safeName(b.name || 'Règle de programmation'),Number(b.priority || 100),b.active !== false,
           b.start_date || null,b.end_date || null,b.days || 'all',b.time_from || null,b.time_to || null,
           Number(b.playlist_id),b.zone,req.params.id]
        );
        if (!result.rows[0]) return res.status(404).json({ error: 'Règle introuvable.' });
        const screen = await q(`UPDATE cx_screens SET sync_version=COALESCE(sync_version,0)+1
                                WHERE id=$1 RETURNING pairing_code`, [result.rows[0].screen_id]);
        notifyPlayer(screen.rows[0]?.pairing_code, { type: 'sync' });
        res.json(result.rows[0]);
      } catch (error) { res.status(400).json({ error: error.message }); }
    });

    app.delete('/api/v31/rules/:id', adminOnly, async (req, res) => {
      try {
        const found = await q('DELETE FROM cx_screen_schedule_rules WHERE id=$1 RETURNING screen_id', [req.params.id]);
        if (!found.rows[0]) return res.status(404).json({ error: 'Règle introuvable.' });
        const screen = await q(`UPDATE cx_screens SET sync_version=COALESCE(sync_version,0)+1
                                WHERE id=$1 RETURNING pairing_code`, [found.rows[0].screen_id]);
        notifyPlayer(screen.rows[0]?.pairing_code, { type: 'sync' });
        res.json({ ok: true });
      } catch (error) { res.status(500).json({ error: error.message }); }
    });

    // Note: the currently deployed V2 player endpoint already evaluates these rules.
    // V3.1 intentionally does not replace it, to avoid a regression in Player V6.5.6.
  }
};

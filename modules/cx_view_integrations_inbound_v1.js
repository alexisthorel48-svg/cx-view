'use strict';
const crypto = require('crypto');

const MAX_ATTEMPTS = 3;
const POLL_INTERVAL_MS = 5000;

const hashKey = key => crypto.createHash('sha256').update(String(key)).digest('hex');
const genKey = () => 'cxv_' + crypto.randomBytes(24).toString('hex');
const taskView = t => ({ id: t.id, external_task_id: t.external_task_id, type: t.type, status: t.status, result: t.result, error_message: t.error_message, created_at: t.created_at, updated_at: t.updated_at });

// Registre des types de tâches supportés. CX Commerce / CX One doivent se mettre d'accord
// avec CX View sur le format de `payload` de chaque type avant qu'un handler soit ajouté ici —
// un type non enregistré est refusé proprement (tâche FAILED) plutôt que de planter le worker.
const HANDLERS = {
  PING: async payload => ({ pong: true, echoed: payload || null })
};

function register({ app, q, adminOnly }) {
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

  // --- Réception de tâches (CX Commerce / CX One -> CX View) ---
  app.post('/api/integrations/inbound/v1/tasks', integrationAuth, async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const externalId = String(req.body.external_task_id || '').trim();
    const type = String(req.body.type || '').trim().toUpperCase();
    const payload = req.body.payload && typeof req.body.payload === 'object' ? req.body.payload : {};
    if (!externalId) return res.status(400).json({ error: 'external_task_id requis' });
    if (!type) return res.status(400).json({ error: 'type requis' });
    try {
      const existing = (await q('SELECT * FROM cx_integration_tasks WHERE client_id=$1 AND external_task_id=$2', [req.integrationClient.id, externalId])).rows[0];
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
        const existing = (await q('SELECT * FROM cx_integration_tasks WHERE client_id=$1 AND external_task_id=$2', [req.integrationClient.id, externalId])).rows[0];
        if (existing) return res.status(200).json({ ok: true, idempotent: true, task: taskView(existing) });
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/integrations/inbound/v1/tasks/:id', integrationAuth, async (req, res) => {
    const task = (await q('SELECT * FROM cx_integration_tasks WHERE id=$1 AND client_id=$2', [Number(req.params.id), req.integrationClient.id])).rows[0];
    if (!task) return res.status(404).json({ error: 'Tâche introuvable' });
    res.json({ ok: true, task: taskView(task) });
  });

  // --- Administration des clients d'intégration (clés API) ---
  app.get('/api/v2/integrations/inbound/clients', adminOnly, async (_req, res) => {
    const rows = (await q('SELECT id,name,active,created_at,last_used_at FROM cx_integration_clients ORDER BY created_at DESC')).rows;
    res.json({ ok: true, clients: rows });
  });
  app.post('/api/v2/integrations/inbound/clients', adminOnly, async (req, res) => {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Nom requis' });
    const key = genKey();
    const created = (await q('INSERT INTO cx_integration_clients(name,api_key_hash) VALUES($1,$2) RETURNING id,name,active,created_at', [name, hashKey(key)])).rows[0];
    res.status(201).json({ ok: true, client: created, api_key: key });
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

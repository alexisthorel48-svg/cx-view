'use strict';

function register({ app, q, auth, adminOnly, superOnly, notifyPlayer }) {
  const isSuper = req => req.session?.userRole === 'SUPER_ADMIN';
  const currentWorkspaceId = async req => {
    if (isSuper(req) && req.query.workspace_id) return Number(req.query.workspace_id);
    if (req.session?.workspaceId) return Number(req.session.workspaceId);
    const r = await q('SELECT workspace_id FROM cx_users WHERE id=$1', [req.session.userId]);
    return r.rows[0]?.workspace_id || null;
  };
  const canManageWorkspace = async (req, workspaceId) => {
    if (isSuper(req)) return true;
    const r = await q(`SELECT 1 FROM cx_workspace_members
      WHERE workspace_id=$1 AND user_id=$2 AND role IN ('OWNER','ADMIN')`, [workspaceId, req.session.userId]);
    return !!r.rows[0];
  };

  app.get('/api/v24/context', auth, async (req,res) => {
    try {
      const workspaceId = await currentWorkspaceId(req);
      const ws = workspaceId ? (await q('SELECT * FROM cx_workspaces WHERE id=$1',[workspaceId])).rows[0] : null;
      res.json({ user_id:req.session.userId, role:req.session.userRole, super_admin:isSuper(req), workspace:ws });
    } catch(e){ res.status(500).json({error:e.message}); }
  });

  app.get('/api/v24/workspaces', auth, async (req,res) => {
    try {
      if (isSuper(req)) {
        const r=await q(`SELECT w.*,
          COUNT(DISTINCT m.user_id)::int member_count,
          COUNT(DISTINCT a.screen_id) FILTER (WHERE a.active=true AND (a.starts_at IS NULL OR a.starts_at<=NOW()) AND (a.ends_at IS NULL OR a.ends_at>NOW()))::int screen_count
          FROM cx_workspaces w
          LEFT JOIN cx_workspace_members m ON m.workspace_id=w.id
          LEFT JOIN cx_screen_assignments a ON a.workspace_id=w.id
          GROUP BY w.id ORDER BY CASE WHEN w.kind='OWNER' THEN 0 ELSE 1 END,w.name`);
        return res.json(r.rows);
      }
      const r=await q(`SELECT w.*,m.role membership_role FROM cx_workspaces w
        JOIN cx_workspace_members m ON m.workspace_id=w.id
        WHERE m.user_id=$1 AND w.active=true ORDER BY w.name`,[req.session.userId]);
      res.json(r.rows);
    } catch(e){res.status(500).json({error:e.message});}
  });

  app.post('/api/v24/workspaces', superOnly, async (req,res) => {
    try {
      const {name,kind='CLIENT',contact_email=null}=req.body;
      if(!name?.trim()) return res.status(400).json({error:'Nom requis'});
      const base=name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || 'workspace';
      const slug=base+'-'+Date.now().toString(36);
      const r=await q('INSERT INTO cx_workspaces(name,slug,kind,contact_email) VALUES($1,$2,$3,$4) RETURNING *',[name.trim(),slug,kind,contact_email]);
      res.status(201).json(r.rows[0]);
    } catch(e){res.status(400).json({error:e.message});}
  });

  app.put('/api/v24/workspaces/:id', auth, async (req,res) => {
    try {
      const id=Number(req.params.id); if(!(await canManageWorkspace(req,id))) return res.status(403).json({error:'Accès refusé'});
      const {name,contact_email,active}=req.body;
      const r=await q('UPDATE cx_workspaces SET name=COALESCE($1,name),contact_email=$2,active=COALESCE($3,active),updated_at=NOW() WHERE id=$4 RETURNING *',[name||null,contact_email??null,active,id]);
      res.json(r.rows[0]);
    } catch(e){res.status(400).json({error:e.message});}
  });

  app.post('/api/v24/context/switch', auth, async (req,res) => {
    try {
      const workspaceId=Number(req.body.workspace_id);
      if(!workspaceId) return res.status(400).json({error:'Workspace invalide'});
      if(!isSuper(req)) {
        const member=await q('SELECT 1 FROM cx_workspace_members WHERE workspace_id=$1 AND user_id=$2',[workspaceId,req.session.userId]);
        if(!member.rows[0]) return res.status(403).json({error:'Accès refusé'});
      }
      req.session.workspaceId=workspaceId;
      res.json({ok:true,workspace_id:workspaceId});
    } catch(e){res.status(500).json({error:e.message});}
  });

  app.get('/api/v24/screens', auth, async (req,res) => {
    try {
      const workspaceId=await currentWorkspaceId(req); const params=[];
      let sql=`SELECT s.*,c.name client_name,g.name group_name,
        ow.name owner_workspace_name,
        aw.id assigned_workspace_id,aw.name assigned_workspace_name,
        a.starts_at assignment_starts_at,a.ends_at assignment_ends_at,
        (s.last_seen_at > NOW()-INTERVAL '5 minutes') online
        FROM cx_screens s
        LEFT JOIN cx_clients c ON c.id=s.client_id
        LEFT JOIN cx_screen_groups g ON g.id=s.group_id
        LEFT JOIN cx_workspaces ow ON ow.id=s.owner_workspace_id
        LEFT JOIN LATERAL (
          SELECT x.* FROM cx_screen_assignments x
          WHERE x.screen_id=s.id AND x.active=true
            AND (x.starts_at IS NULL OR x.starts_at<=NOW())
            AND (x.ends_at IS NULL OR x.ends_at>NOW())
          ORDER BY x.created_at DESC LIMIT 1
        ) a ON true
        LEFT JOIN cx_workspaces aw ON aw.id=a.workspace_id WHERE 1=1`;
      if(!isSuper(req)){params.push(workspaceId);sql+=` AND a.workspace_id=$${params.length}`;}
      else if(req.query.workspace_id){params.push(Number(req.query.workspace_id));sql+=` AND a.workspace_id=$${params.length}`;}
      if(req.query.type){params.push(req.query.type);sql+=` AND s.screen_type=$${params.length}`;}
      if(req.query.status==='online') sql+=` AND s.last_seen_at>NOW()-INTERVAL '5 minutes'`;
      if(req.query.status==='offline') sql+=` AND (s.last_seen_at IS NULL OR s.last_seen_at<=NOW()-INTERVAL '5 minutes')`;
      if(req.query.search){params.push('%'+req.query.search+'%');sql+=` AND (s.name ILIKE $${params.length} OR s.pairing_code ILIKE $${params.length} OR COALESCE(s.location_label,'') ILIKE $${params.length} OR COALESCE(aw.name,'') ILIKE $${params.length})`;}
      sql+=' ORDER BY online DESC,s.screen_type,s.name';
      res.json((await q(sql,params)).rows);
    } catch(e){res.status(500).json({error:e.message});}
  });

  app.post('/api/v24/screens/:id/assign', superOnly, async (req,res) => {
    const client=await q('SELECT client_id FROM cx_screens WHERE id=$1',[req.params.id]);
    try {
      const screenId=Number(req.params.id), workspaceId=Number(req.body.workspace_id);
      if(!workspaceId) return res.status(400).json({error:'Workspace requis'});
      await q('UPDATE cx_screen_assignments SET active=false WHERE screen_id=$1 AND active=true',[screenId]);
      const r=await q(`INSERT INTO cx_screen_assignments(screen_id,workspace_id,starts_at,ends_at,notes)
        VALUES($1,$2,$3,$4,$5) RETURNING *`,[screenId,workspaceId,req.body.starts_at||null,req.body.ends_at||null,req.body.notes||null]);
      const legacyClient=await q('SELECT id FROM cx_clients WHERE name=(SELECT name FROM cx_workspaces WHERE id=$1)',[workspaceId]);
      if(legacyClient.rows[0]) await q('UPDATE cx_screens SET client_id=$1 WHERE id=$2',[legacyClient.rows[0].id,screenId]);
      const screen=await q('SELECT pairing_code FROM cx_screens WHERE id=$1',[screenId]);
      if(screen.rows[0]) notifyPlayer(screen.rows[0].pairing_code,{type:'sync'});
      res.status(201).json(r.rows[0]);
    } catch(e){res.status(400).json({error:e.message});}
  });

  app.delete('/api/v24/screens/:id/assignment', superOnly, async (req,res) => {
    try {
      await q('UPDATE cx_screen_assignments SET active=false WHERE screen_id=$1 AND active=true',[req.params.id]);
      await q('UPDATE cx_screens SET client_id=NULL WHERE id=$1',[req.params.id]);
      res.json({ok:true});
    } catch(e){res.status(500).json({error:e.message});}
  });

  app.get('/api/v24/workspaces/:id/members', auth, async (req,res) => {
    const id=Number(req.params.id); if(!(await canManageWorkspace(req,id))) return res.status(403).json({error:'Accès refusé'});
    const r=await q(`SELECT u.id,u.email,u.display_name,u.active,m.role
      FROM cx_workspace_members m JOIN cx_users u ON u.id=m.user_id
      WHERE m.workspace_id=$1 ORDER BY u.display_name`,[id]);
    res.json(r.rows);
  });
}
module.exports={register};

async function loadAccounts() {
  const el = document.getElementById('page-accounts');
  el.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><p>Chargement...</p></div>';
  try {
    const accounts = await GET('/api/accounts');
    el.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">🔑 Comptes utilisateurs</h1>
        <button class="btn btn-primary" onclick="openAccountForm()">+ Nouveau compte</button>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Nom</th><th>Email</th><th>Rôle</th><th>Client</th><th>Statut</th><th>Créé le</th><th>Actions</th></tr></thead>
        <tbody>${accounts.map(a => `<tr>
          <td><strong>${a.display_name}</strong></td>
          <td>${a.email}</td>
          <td><span class="badge ${a.role==='SUPER_ADMIN'?'badge-orange':a.role==='ADMIN'?'badge-blue':'badge-green'}">${a.role==='SUPER_ADMIN'?'Super Admin':a.role==='ADMIN'?'Admin':'Client'}</span></td>
          <td>${a.client_name||'—'}</td>
          <td><span class="badge ${a.active?'badge-green':'badge-red'}">${a.active?'Actif':'Inactif'}</span></td>
          <td>${fmtDate(a.created_at)}</td>
          <td><div class="actions">
            <button class="btn btn-sm btn-secondary" onclick='openAccountForm(${JSON.stringify(a)})'>Modifier</button>
            <button class="btn btn-sm btn-danger" onclick="deleteAccount(${a.id})">Supprimer</button>
          </div></td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  } catch (e) { el.innerHTML = `<div class="empty"><p>${e.message}</p></div>`; }
}

function openAccountForm(account) {
  openModal(account ? 'Modifier le compte' : 'Nouveau compte', `
    <div class="form-group"><label>Nom d'affichage *</label><input id="a-name" value="${account?.display_name||''}" placeholder="Prénom Nom"></div>
    <div class="form-group"><label>Email *</label><input id="a-email" type="email" value="${account?.email||''}" placeholder="email@exemple.com"></div>
    <div class="form-group"><label>Mot de passe ${account?'(laisser vide pour ne pas changer)':'*'}</label><input id="a-password" type="password" placeholder="••••••••"></div>
    <div class="form-row">
      <div class="form-group"><label>Rôle</label>
        <select id="a-role" onchange="toggleClientField()">
          <option value="ADMIN" ${account?.role==='ADMIN'?'selected':''}>Admin équipe</option>
          <option value="CLIENT" ${account?.role==='CLIENT'?'selected':''}>Client</option>
          <option value="SUPER_ADMIN" ${account?.role==='SUPER_ADMIN'?'selected':''}>Super Admin</option>
        </select>
      </div>
      <div class="form-group" id="client-field" style="${account?.role==='CLIENT'?'':'display:none'}">
        <label>Client associé</label>
        <select id="a-client">
          <option value="">Aucun</option>
          ${allClients.map(c=>`<option value="${c.id}" ${account?.client_id==c.id?'selected':''}>${c.name}</option>`).join('')}
        </select>
      </div>
    </div>
    ${account ? `<div class="form-group"><label>Statut</label><select id="a-active"><option value="true" ${account.active?'selected':''}>Actif</option><option value="false" ${!account.active?'selected':''}>Inactif</option></select></div>` : ''}
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Annuler</button>
      <button class="btn btn-primary" onclick="saveAccount(${account?.id||'null'})">Enregistrer</button>
    </div>`);
  toggleClientField();
}

function toggleClientField() {
  const role = document.getElementById('a-role')?.value;
  const field = document.getElementById('client-field');
  if (field) field.style.display = role === 'CLIENT' ? '' : 'none';
}

async function saveAccount(id) {
  const name = document.getElementById('a-name').value.trim();
  const email = document.getElementById('a-email').value.trim();
  const password = document.getElementById('a-password').value;
  const role = document.getElementById('a-role').value;
  const client_id = document.getElementById('a-client')?.value || null;
  if (!name || !email) { toast('Nom et email requis', 'error'); return; }
  if (!id && !password) { toast('Mot de passe requis pour un nouveau compte', 'error'); return; }
  try {
    const data = { email, display_name: name, role, client_id: client_id || null };
    if (password) data.password = password;
    if (id) {
      data.active = document.getElementById('a-active').value === 'true';
      await PUT(`/api/accounts/${id}`, data);
    } else {
      await POST('/api/accounts', data);
    }
    closeModal(); toast('Compte enregistré'); loadAccounts();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteAccount(id) {
  if (!confirm('Supprimer ce compte ?')) return;
  try { await DEL(`/api/accounts/${id}`); toast('Compte supprimé'); loadAccounts(); }
  catch (e) { toast(e.message, 'error'); }
}

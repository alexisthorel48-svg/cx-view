async function loadClients() {
  const el = document.getElementById('page-clients');
  el.innerHTML = '<div class="empty"><div class="empty-icon">⏳</div><p>Chargement...</p></div>';
  try {
    const clients = await GET('/api/clients');
    el.innerHTML = `
      <div class="page-header">
        <h1 class="page-title">👥 Clients</h1>
        <button class="btn btn-primary" onclick="openClientForm()">+ Nouveau client</button>
      </div>
      ${clients.length === 0 ? `<div class="empty"><div class="empty-icon">👥</div><p>Aucun client</p><button class="btn btn-primary" onclick="openClientForm()">Créer le premier client</button></div>` :
      `<div class="table-wrap"><table>
        <thead><tr><th>Nom</th><th>Email</th><th>Statut</th><th>Créé le</th><th>Actions</th></tr></thead>
        <tbody>${clients.map(c => `<tr>
          <td><strong>${c.name}</strong></td>
          <td>${c.contact_email||'—'}</td>
          <td><span class="badge ${c.active?'badge-green':'badge-red'}">${c.active?'Actif':'Inactif'}</span></td>
          <td>${fmtDate(c.created_at)}</td>
          <td><div class="actions">
            <button class="btn btn-sm btn-secondary" onclick='openClientForm(${JSON.stringify(c)})'>Modifier</button>
            <button class="btn btn-sm btn-danger" onclick="deleteClient(${c.id})">Supprimer</button>
          </div></td>
        </tr>`).join('')}</tbody>
      </table></div>`}`;
  } catch (e) { el.innerHTML = `<div class="empty"><p>${e.message}</p></div>`; }
}

function openClientForm(client) {
  openModal(client ? 'Modifier le client' : 'Nouveau client', `
    <div class="form-group"><label>Nom *</label><input id="c-name" value="${client?.name||''}" placeholder="Nom du client"></div>
    <div class="form-group"><label>Email de contact</label><input id="c-email" type="email" value="${client?.contact_email||''}" placeholder="contact@client.com"></div>
    ${client ? `<div class="form-group"><label>Statut</label><select id="c-active"><option value="true" ${client.active?'selected':''}>Actif</option><option value="false" ${!client.active?'selected':''}>Inactif</option></select></div>` : ''}
    <div class="form-actions">
      <button class="btn btn-secondary" onclick="closeModal()">Annuler</button>
      <button class="btn btn-primary" onclick="saveClient(${client?.id||'null'})">Enregistrer</button>
    </div>`);
}

async function saveClient(id) {
  const name = document.getElementById('c-name').value.trim();
  if (!name) { toast('Le nom est requis', 'error'); return; }
  try {
    if (id) await PUT(`/api/clients/${id}`, { name, contact_email: document.getElementById('c-email').value, active: document.getElementById('c-active').value === 'true' });
    else await POST('/api/clients', { name, contact_email: document.getElementById('c-email').value });
    closeModal(); toast('Client enregistré');
    allClients = await GET('/api/clients');
    loadClients();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteClient(id) {
  if (!confirm('Supprimer ce client ?')) return;
  try { await DEL(`/api/clients/${id}`); toast('Client supprimé'); allClients = await GET('/api/clients'); loadClients(); }
  catch (e) { toast(e.message, 'error'); }
}

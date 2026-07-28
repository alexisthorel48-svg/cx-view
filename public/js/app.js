let currentUser = null;
let allClients = [];
let allPlaylists = [];

const pages = {
  dashboard: loadDashboard,
  clients: loadClients,
  media: loadMedia,
  playlists: loadPlaylists,
  screens: loadScreens,
  stats: loadStats,
  history: loadHistory,
  accounts: loadAccounts
};

function navigate(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-links a').forEach(a => a.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (!pageEl) return;
  pageEl.classList.add('active');
  const link = document.querySelector(`[data-page="${page}"]`);
  if (link) link.classList.add('active');
  if (pages[page]) pages[page]();
}

document.querySelectorAll('.nav-links a').forEach(a => {
  a.addEventListener('click', e => { e.preventDefault(); navigate(a.dataset.page); });
});

(async () => {
  try {
    currentUser = await GET('/api/auth/me');
    if (currentUser) {
      document.getElementById('user-name').textContent = currentUser.display_name;
      if (currentUser.role === 'SUPER_ADMIN') {
        document.querySelectorAll('.super-only').forEach(el => el.style.display = '');
      }
    }
    allClients = await GET('/api/clients');
    allPlaylists = await GET('/api/playlists');
  } catch {}
  navigate('dashboard');
})();

// Media picker
let pickerAllMedia = [];
let pickerSelected = [];
let pickerCallback = null;

async function openPicker(cb) {
  pickerCallback = cb;
  pickerSelected = [];
  document.getElementById('picker-overlay').classList.add('open');
  document.getElementById('picker-search').value = '';
  document.getElementById('picker-type').value = '';
  const clientSel = document.getElementById('picker-client');
  clientSel.innerHTML = '<option value="">Tous les clients</option>' + allClients.map(c => `<option value="${c.id}">${c.name}</option>`).join('');
  pickerAllMedia = await GET('/api/media');
  renderPickerGrid(pickerAllMedia);
}

function closePicker() {
  document.getElementById('picker-overlay').classList.remove('open');
}

function filterPicker() {
  const search = document.getElementById('picker-search').value.toLowerCase();
  const type = document.getElementById('picker-type').value;
  const client = document.getElementById('picker-client').value;
  const filtered = pickerAllMedia.filter(m => {
    if (type && m.media_type !== type) return false;
    if (client && String(m.client_id) !== client) return false;
    if (search && !m.title.toLowerCase().includes(search)) return false;
    return true;
  });
  renderPickerGrid(filtered);
}

function renderPickerGrid(items) {
  const grid = document.getElementById('picker-grid');
  const countEl = document.getElementById('picker-count');
  if (countEl) countEl.textContent = pickerSelected.length ? `${pickerSelected.length} sélectionné(s)` : '';
  if (!items.length) { grid.innerHTML = '<div class="empty"><div class="empty-icon">🗂️</div><p>Aucun média trouvé</p></div>'; return; }
  grid.innerHTML = items.map(m => {
    const thumb = m.thumbnail_name ? `<img class="media-thumb" src="/files/thumbs/${m.thumbnail_name}" alt="">` : `<div class="media-thumb-placeholder">${m.media_type==='VIDEO'?'🎬':'🖼️'}</div>`;
    const sel = pickerSelected.find(s=>s.id===m.id) ? 'selected' : '';
    return `<div class="media-card ${sel}" onclick="togglePickerItem(${m.id})" data-id="${m.id}">
      ${thumb}
      <div class="media-check">✓</div>
      <div class="media-info">
        <div class="media-title">${m.title}</div>
        <div class="media-meta">${m.media_type} · ${fmtBytes(m.bytes)}</div>
      </div>
    </div>`;
  }).join('');
}

function togglePickerItem(id) {
  const media = pickerAllMedia.find(m => m.id === id);
  const idx = pickerSelected.findIndex(m => m.id === id);
  if (idx >= 0) pickerSelected.splice(idx, 1);
  else pickerSelected.push(media);
  document.querySelectorAll(`[data-id="${id}"]`).forEach(el => el.classList.toggle('selected', pickerSelected.some(m=>m.id===id)));
  const countEl = document.getElementById('picker-count');
  if (countEl) countEl.textContent = pickerSelected.length ? `${pickerSelected.length} sélectionné(s)` : '';
}

function confirmPicker() {
  if (pickerCallback) pickerCallback([...pickerSelected]);
  closePicker();

// CX View V2.5 scheduler fallback
document.addEventListener('click',e=>{const a=e.target.closest('[data-page="scheduler"]');if(a)setTimeout(()=>window.renderSchedulerV25&&window.renderSchedulerV25(),0)});
}

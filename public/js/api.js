async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (body && !(body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body) {
    opts.body = body;
  }
  const r = await fetch(url, opts);
  if (r.status === 401) { window.location.href = '/login'; return; }
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'Erreur serveur');
  return d;
}
const GET = (url) => api('GET', url);
const POST = (url, body) => api('POST', url, body);
const PUT = (url, body) => api('PUT', url, body);
const DEL = (url) => api('DELETE', url);

function toast(msg, type='success') {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id='toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = type;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3000);
}

function openModal(title, html) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-body').innerHTML = html;
  document.getElementById('modal-overlay').classList.add('open');
}
function closeModal() {
  document.getElementById('modal-overlay').classList.remove('open');
}

function fmtBytes(b) {
  if (!b) return '0 o';
  if (b < 1024) return b + ' o';
  if (b < 1048576) return (b/1024).toFixed(1) + ' Ko';
  return (b/1048576).toFixed(1) + ' Mo';
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('fr-BE', {day:'2-digit',month:'2-digit',year:'numeric'});
}

function fmtDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('fr-BE', {day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

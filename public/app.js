'use strict';
const ST = { recibido: 'Recibido', diagnostico: 'Diagnóstico', mantenimiento: 'En mantenimiento', espera_refacciones: 'Esperando refacciones', listo: 'Listo para entrega', entregado: 'Entregado' };
const ROLE = { admin: 'Administrador', mecanico: 'Mecánico' };
const $app = document.getElementById('app');
const $who = document.getElementById('who');
let token = sessionStorage.getItem('token');
let user = null;

// Crea elementos con textContent: nunca inyecta HTML del usuario (evita XSS)
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) el.append(kid);
  return el;
}
const mount = (...nodes) => $app.replaceChildren(...nodes.flat(Infinity).filter(Boolean));
const field = (label, attrs, tag = 'input') => [h('label', { for: attrs.id }, label), h(tag, attrs)];
const fmt = (s) => new Date(s.replace(' ', 'T') + 'Z').toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' });

async function api(path, method = 'GET', body) {
  const res = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token) logout();
    throw new Error(data.error || 'Algo salió mal');
  }
  return data;
}

function logout() {
  token = null; user = null; sessionStorage.removeItem('token');
  $who.replaceChildren(); showAuth();
}

// ---------- Inicio público: consultar folio o entrar al taller ----------
function showAuth(mode = 'folio') {
  const err = h('p', { class: 'err', role: 'alert' });
  let panel;
  if (mode === 'folio') {
    const out = h('div');
    const input = h('input', { id: 'folio', placeholder: 'AM-1A2B3C4D', 'aria-label': 'Folio', autocomplete: 'off', required: '' });
    panel = h('div', {}, h('form', { class: 'card narrow', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = ''; out.replaceChildren();
      try { out.append(repairCard(await api('/track/' + encodeURIComponent(input.value.trim())))); } catch (x) { err.textContent = x.message; }
    } }, h('label', { for: 'folio' }, 'Tu folio'), input, err, h('button', { class: 'btn block', type: 'submit' }, 'Consultar')), out);
  } else {
    panel = h('form', { class: 'card narrow', onsubmit: async (e) => {
      e.preventDefault(); err.textContent = '';
      try {
        const r = await api('/auth/login', 'POST', Object.fromEntries(new FormData(e.target)));
        token = r.token; user = r.user; sessionStorage.setItem('token', token); start();
      } catch (x) { err.textContent = x.message; }
    } },
      field('Correo', { id: 'email', name: 'email', type: 'email', required: '', autocomplete: 'email' }),
      field('Contraseña', { id: 'password', name: 'password', type: 'password', required: '', autocomplete: 'current-password' }),
      err, h('button', { class: 'btn block', type: 'submit' }, 'Iniciar sesión'));
  }
  mount(
    h('div', { class: 'center' }, h('h1', {}, 'El estado de tu coche,'), h('h1', {}, 'siempre a la mano.'),
      h('p', { class: 'lead', style: 'margin:12px auto 32px' }, 'Escribe el folio que te entregó tu mecánico.')),
    seg([['folio', 'Consultar folio'], ['login', 'Acceso del taller']], mode, showAuth),
    panel);
}

function seg(items, current, onPick) {
  return h('div', { class: 'center' }, h('div', { class: 'seg', role: 'tablist' },
    items.map(([k, label]) => h('button', { type: 'button', role: 'tab', class: k === current ? 'on' : '', 'aria-selected': String(k === current), onclick: () => onPick(k) }, label))));
}

// ---------- Componentes ----------
function repairCard(r, { staff = false, admin = false, reload } = {}) {
  const idx = ST_ORDER.indexOf(r.status);
  const steps = h('div', { class: 'steps' }, ST_ORDER.map((s, i) =>
    h('div', { class: 'step' + (i <= idx ? ' done' : '') + (i === idx ? ' now' : '') }, ST[s])));
  const card = h('div', { class: 'card' },
    h('div', { class: 'row' },
      h('div', {}, h('div', { class: 'folio' }, r.folio), h('p', { class: 'sub' }, `${r.make} ${r.model}${r.year ? ' ' + r.year : ''} · ${r.plate}${staff && r.status !== 'entregado' ? ` · ${daysOpen(r)} ${daysOpen(r) === 1 ? 'día' : 'días'} en taller` : ''}`)),
      h('span', { class: 'badge ' + r.status }, ST[r.status])),
    h('p', {}, r.description), steps, priceBlock(r, staff, reload),
    h('ul', { class: 'hist' }, r.history.slice().reverse().map((x) => h('li', {}, `${fmt(x.created_at)} — ${ST[x.status]}${x.note ? ': ' + x.note : ''}`))));
  if (staff) {
    const sel = h('select', { 'aria-label': 'Nuevo estatus' }, ST_ORDER.map((s) => { const o = h('option', { value: s }, ST[s]); if (s === r.status) o.selected = true; return o; }));
    const note = h('input', { placeholder: 'Nota para el cliente (opcional)', 'aria-label': 'Nota' });
    const next = ST_ORDER[idx + 1];
    card.append(h('div', { class: 'actions' },
      next ? h('button', { class: 'btn', onclick: async () => { await api(`/repairs/${r.id}/status`, 'PATCH', { status: next, note: note.value }); reload(); } }, 'Pasar a ' + ST[next]) : null,
      sel, note,
      h('button', { class: 'btn text', onclick: async () => { await api(`/repairs/${r.id}/status`, 'PATCH', { status: sel.value, note: note.value }); reload(); } }, 'Guardar cambio'),
      admin ? h('button', { class: 'btn danger', onclick: async () => { if (confirm('¿Eliminar esta reparación?')) { await api('/repairs/' + r.id, 'DELETE'); reload(); } } }, 'Eliminar') : null));
  }
  return card;
}
const ST_ORDER = Object.keys(ST);
const money = (n) => n.toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
const daysOpen = (r) => Math.floor((Date.now() - new Date(r.created_at.replace(' ', 'T') + 'Z')) / 864e5);

function priceBlock(r, staff, reload) {
  if (!r.items.length && !staff) return null;
  const rows = r.items.map((i) => h('tr', {}, h('td', {}, i.concept),
    h('td', {}, money(i.amount), staff ? [' ', h('button', { class: 'btn danger', 'aria-label': 'Quitar ' + i.concept, onclick: async () => { await api(`/repairs/${r.id}/items/${i.id}`, 'DELETE'); reload(); } }, 'Quitar')] : null)));
  const box = h('div', {}, h('h2', { style: 'font-size:19px;margin:24px 0 8px' }, 'Costos'),
    r.items.length ? h('table', {}, h('tbody', {}, rows, h('tr', {}, h('td', {}, h('strong', {}, 'Total')), h('td', {}, h('strong', {}, money(r.total))))))
      : h('p', { class: 'sub' }, 'Aún no hay costos. Agrega el primero.'));
  if (staff) {
    const c = h('input', { placeholder: 'Concepto (ej. Balatas)', 'aria-label': 'Concepto' });
    const a = h('input', { type: 'number', min: '0', step: '0.01', placeholder: 'Precio', 'aria-label': 'Precio' });
    const err = h('p', { class: 'err' });
    box.append(h('div', { class: 'actions' }, c, a, h('button', { class: 'btn', onclick: async () => {
      try { await api(`/repairs/${r.id}/items`, 'POST', { concept: c.value, amount: a.value }); reload(); } catch (x) { err.textContent = x.message; }
    } }, 'Agregar costo')), err);
  }
  return box;
}

// ---------- Vistas por rol ----------
async function viewStaff(isAdmin, tab = 'repairs') {
  if (isAdmin) return adminShell(tab);
  mount(h('h1', {}, 'Taller'), h('p', { class: 'lead' }, 'Registra vehículos y mantén informados a tus clientes.'), ...(await repairsPanel(false)));
}

async function repairsPanel(admin) {
  const err = h('p', { class: 'err' }), ok = h('p', { class: 'ok' });
  const reload = () => (admin ? adminShell('repairs') : viewStaff(false));
  const form = h('form', { class: 'card', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; ok.textContent = '';
    const f = Object.fromEntries(new FormData(e.target)); f.year = parseInt(f.year, 10) || null;
    try { const r = await api('/repairs', 'POST', f); await reload(); alert('Folio generado: ' + r.folio + '\nEntrégalo a tu cliente.'); } catch (x) { err.textContent = x.message; }
  } },
    h('div', { class: 'grid' },
      h('div', {}, field('Placas', { id: 'p', name: 'plate', required: '' })),
      h('div', {}, field('Marca', { id: 'm', name: 'make', required: '' }), field('Modelo', { id: 'mo', name: 'model', required: '' })),
      h('div', {}, field('Año', { id: 'y', name: 'year', type: 'number', min: '1951', max: '2099' }))),
    field('¿Qué necesita el coche?', { id: 'd', name: 'description', required: '', maxlength: '500' }, 'textarea'),
    err, h('button', { class: 'btn', type: 'submit' }, 'Registrar y generar folio'));
  const list = await api('/repairs');
  return [h('h2', {}, 'Nueva reparación'), form, h('h2', {}, 'Cola de trabajo'), h('p', { class: 'sub' }, 'Los coches que llevan más tiempo van primero. Los entregados quedan al final.'),
    list.length ? list.map((r) => repairCard(r, { staff: true, admin, reload })) : h('p', { class: 'sub' }, 'Aún no hay reparaciones. Registra la primera arriba.')];
}

async function adminShell(tab) {
  const nav = seg([['repairs', 'Reparaciones'], ['users', 'Usuarios y roles'], ['stats', 'Resumen']], tab, adminShell);
  const head = [h('h1', {}, 'Administración'), h('p', { class: 'lead' }, 'Control total de reparaciones, usuarios y roles.'), nav];
  if (tab === 'users') {
    const users = await api('/admin/users'), err = h('p', { class: 'err' });
    const rows = users.map((u) => h('tr', {}, h('td', {}, h('strong', {}, u.name), h('div', { class: 'sub' }, u.email)),
      h('td', {}, u.id === user.id ? h('span', { class: 'badge' }, ROLE[u.role] + ' (tú)') :
        h('select', { 'aria-label': 'Rol de ' + u.name, onchange: async (e) => { try { await api(`/admin/users/${u.id}/role`, 'PATCH', { role: e.target.value }); } catch (x) { err.textContent = x.message; } } },
          Object.entries(ROLE).map(([k, v]) => { const o = h('option', { value: k }, v); if (k === u.role) o.selected = true; return o; })))));
    const err2 = h('p', { class: 'err' });
    const newUser = h('form', { class: 'card', onsubmit: async (e) => {
      e.preventDefault(); err2.textContent = '';
      try { await api('/admin/users', 'POST', Object.fromEntries(new FormData(e.target))); adminShell('users'); } catch (x) { err2.textContent = x.message; }
    } }, h('div', { class: 'grid' },
      h('div', {}, field('Nombre', { id: 'n', name: 'name', required: '' }), field('Correo', { id: 'e', name: 'email', type: 'email', required: '' })),
      h('div', {}, field('Contraseña (mínimo 8)', { id: 'pw', name: 'password', type: 'password', required: '', minlength: '8' }),
        h('label', { for: 'r' }, 'Rol'), h('select', { id: 'r', name: 'role' }, h('option', { value: 'mecanico' }, 'Mecánico'), h('option', { value: 'admin' }, 'Administrador')))),
      err2, h('button', { class: 'btn', type: 'submit' }, 'Crear usuario'));
    return mount(...head, h('h2', {}, 'Nuevo usuario'), newUser, h('h2', {}, 'Usuarios'), h('div', { class: 'card' }, h('table', {}, h('tbody', {}, rows)), err));
  }
  if (tab === 'stats') {
    const s = await api('/admin/stats');
    const tile = (label, n) => h('div', { class: 'card' }, h('div', { class: 'stat' }, String(n)), h('p', { class: 'sub' }, label));
    return mount(...head, h('h2', {}, 'Reparaciones por estatus'), h('div', { class: 'grid' }, s.repairsByStatus.length ? s.repairsByStatus.map((x) => tile(ST[x.status], x.total)) : h('p', { class: 'sub' }, 'Sin reparaciones todavía.')),
      h('h2', {}, 'Usuarios por rol'), h('div', { class: 'grid' }, s.usersByRole.map((x) => tile(ROLE[x.role], x.total))));
  }
  mount(...head, ...(await repairsPanel(true)));
}

// ---------- Inicio ----------
async function start() {
  $who.replaceChildren(h('span', {}, `${user.name} · ${ROLE[user.role]}`), h('button', { class: 'btn text', onclick: logout }, 'Cerrar sesión'));
  try {
    await viewStaff(user.role === 'admin');
  } catch (x) { mount(h('p', { class: 'err' }, x.message)); }
}

(async () => {
  if (!token) return showAuth();
  try { user = (await api('/me')).user; start(); } catch { showAuth(); }
})();

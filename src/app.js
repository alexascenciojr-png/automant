const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { STATUSES, ROLES } = require('./db');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function createApp(db, { secret = 'dev-secret-change-me', authLimit = 100, trackLimit = 60 } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(path.join(__dirname, '..', 'public')));

  const sign = (u) => jwt.sign({ id: u.id }, secret, { expiresIn: '8h' });
  const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

  // ---------- Middlewares ----------
  const auth = (req, res, next) => {
    const token = (req.headers.authorization || '').replace(/^Bearer /, '');
    try {
      const { id } = jwt.verify(token, secret);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
      if (!user) throw new Error('user');
      req.user = user;
      next();
    } catch {
      res.status(401).json({ error: 'Sesión inválida o expirada' });
    }
  };
  const allow = (...roles) => (req, res, next) =>
    roles.includes(req.user.role) ? next() : res.status(403).json({ error: 'No tienes permiso para esta acción' });

  const getRepair = (where, ...args) => {
    const r = db.prepare(`SELECT * FROM repairs WHERE ${where}`).get(...args);
    if (!r) return null;
    r.history = db.prepare('SELECT status, note, created_at FROM status_history WHERE repair_id = ? ORDER BY id').all(r.id);
    r.items = db.prepare('SELECT id, concept, amount FROM repair_items WHERE repair_id = ? ORDER BY id').all(r.id);
    r.total = Math.round(r.items.reduce((sum, i) => sum + i.amount, 0) * 100) / 100;
    return r;
  };
  // Reparación que el mecánico puede modificar (las suyas; el admin, todas)
  const staffRepair = (req) => {
    const r = getRepair('id = ?', Number(req.params.id));
    return r && (req.user.role === 'admin' || r.mechanic_id === req.user.id) ? r : null;
  };
  // Cola de trabajo: los que llevan más tiempo primero, entregados al final
  const QUEUE = "ORDER BY (status = 'entregado'), created_at, id";

  // ---------- Auth ----------
  const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: authLimit, standardHeaders: true, legacyHeaders: false });
  const trackLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: trackLimit, standardHeaders: true, legacyHeaders: false });

  app.post('/api/auth/login', limiter, (req, res) => {
    const email = str(req.body.email, 120).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
    res.json({ token: sign(user), user: publicUser(user) });
  });

  app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

  // ---------- Reparaciones ----------
  app.post('/api/repairs', auth, allow('mecanico', 'admin'), (req, res) => {
    const b = req.body;
    const data = {
      plate: str(b.plate, 15).toUpperCase(),
      make: str(b.make, 40),
      model: str(b.model, 40),
      year: Number.isInteger(b.year) && b.year > 1950 && b.year < 2100 ? b.year : null,
      description: str(b.description, 500),
    };
    if (!data.plate || !data.make || !data.model || !data.description)
      return res.status(400).json({ error: 'Completa placas, marca, modelo y descripción' });
    const folio = 'AM-' + crypto.randomBytes(4).toString('hex').toUpperCase();
    const create = db.transaction(() => {
      const info = db
        .prepare(`INSERT INTO repairs (folio, mechanic_id, plate, make, model, year, description)
                  VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(folio, req.user.id, data.plate, data.make, data.model, data.year, data.description);
      db.prepare('INSERT INTO status_history (repair_id, status, note) VALUES (?, ?, ?)')
        .run(info.lastInsertRowid, 'recibido', 'Vehículo recibido en el taller');
      return info.lastInsertRowid;
    });
    res.status(201).json(getRepair('id = ?', create()));
  });

  app.get('/api/repairs', auth, (req, res) => {
    let rows;
    if (req.user.role === 'admin') rows = db.prepare('SELECT id FROM repairs ' + QUEUE).all();
    else rows = db.prepare('SELECT id FROM repairs WHERE mechanic_id = ? ' + QUEUE).all(req.user.id);
    res.json(rows.map((r) => getRepair('id = ?', r.id)));
  });

  // Consulta pública: el folio es lo único que necesita el cliente (sin cuenta ni sesión)
  app.get('/api/track/:folio', trackLimiter, (req, res) => {
    const r = getRepair('folio = ?', str(req.params.folio, 20).toUpperCase());
    if (!r) return res.status(404).json({ error: 'No encontramos un folio con ese número' });
    const { folio, plate, make, model, year, description, status, created_at, updated_at, history, items, total } = r;
    res.json({ folio, plate, make, model, year, description, status, created_at, updated_at, history, items, total });
  });

  app.patch('/api/repairs/:id/status', auth, allow('mecanico', 'admin'), (req, res) => {
    const r = staffRepair(req);
    if (!r) return res.status(404).json({ error: 'Reparación no encontrada' });
    const status = str(req.body.status, 30);
    if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Estatus no válido' });
    db.transaction(() => {
      db.prepare('UPDATE repairs SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(status, r.id);
      db.prepare('INSERT INTO status_history (repair_id, status, note) VALUES (?, ?, ?)')
        .run(r.id, status, str(req.body.note, 200));
    })();
    res.json(getRepair('id = ?', r.id));
  });

  // ---------- Costos de la reparación ----------
  app.post('/api/repairs/:id/items', auth, allow('mecanico', 'admin'), (req, res) => {
    const r = staffRepair(req);
    if (!r) return res.status(404).json({ error: 'Reparación no encontrada' });
    const concept = str(req.body.concept, 100);
    const amount = Number(req.body.amount);
    if (!concept || !Number.isFinite(amount) || amount < 0 || amount > 10000000)
      return res.status(400).json({ error: 'Escribe un concepto y un precio válido' });
    db.prepare('INSERT INTO repair_items (repair_id, concept, amount) VALUES (?, ?, ?)')
      .run(r.id, concept, Math.round(amount * 100) / 100);
    res.status(201).json(getRepair('id = ?', r.id));
  });

  app.delete('/api/repairs/:id/items/:itemId', auth, allow('mecanico', 'admin'), (req, res) => {
    const r = staffRepair(req);
    if (!r) return res.status(404).json({ error: 'Reparación no encontrada' });
    db.prepare('DELETE FROM repair_items WHERE id = ? AND repair_id = ?').run(Number(req.params.itemId), r.id);
    res.json(getRepair('id = ?', r.id));
  });

  // ---------- Solo administrador ----------
  app.delete('/api/repairs/:id', auth, allow('admin'), (req, res) => {
    const info = db.prepare('DELETE FROM repairs WHERE id = ?').run(Number(req.params.id));
    if (!info.changes) return res.status(404).json({ error: 'Reparación no encontrada' });
    res.status(204).end();
  });

  app.get('/api/admin/users', auth, allow('admin'), (req, res) =>
    res.json(db.prepare('SELECT id, name, email, role FROM users ORDER BY id').all()));

  app.post('/api/admin/users', auth, allow('admin'), (req, res) => {
    const name = str(req.body.name, 80);
    const email = str(req.body.email, 120).toLowerCase();
    const password = typeof req.body.password === 'string' ? req.body.password : '';
    const role = str(req.body.role, 20);
    if (!name || !EMAIL_RE.test(email) || password.length < 8 || password.length > 72 || !ROLES.includes(role))
      return res.status(400).json({ error: 'Revisa nombre, correo, rol y contraseña (mínimo 8 caracteres)' });
    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
      return res.status(409).json({ error: 'Ese correo ya está registrado' });
    const info = db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name, email, bcrypt.hashSync(password, 10), role);
    res.status(201).json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid)));
  });

  app.patch('/api/admin/users/:id/role', auth, allow('admin'), (req, res) => {
    const id = Number(req.params.id);
    const role = str(req.body.role, 20);
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Rol no válido' });
    if (id === req.user.id) return res.status(400).json({ error: 'No puedes cambiar tu propio rol' });
    const info = db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
    if (!info.changes) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id)));
  });

  app.get('/api/admin/stats', auth, allow('admin'), (req, res) =>
    res.json({
      repairsByStatus: db.prepare('SELECT status, COUNT(*) AS total FROM repairs GROUP BY status').all(),
      usersByRole: db.prepare('SELECT role, COUNT(*) AS total FROM users GROUP BY role').all(),
    }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => res.status(err.status === 400 ? 400 : 500).json({ error: 'Solicitud no válida' }));
  return app;
}

module.exports = { createApp };

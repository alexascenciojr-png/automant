const os = require('os');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const request = require('supertest');
const bcrypt = require('bcryptjs');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

let app, db;
const t = {};
const body = { plate: 'abc123', make: 'Nissan', model: 'Versa', year: 2020, description: 'Cambio de frenos' };
const bearer = (tk) => ({ Authorization: `Bearer ${tk}` });
const login = async (email, password = 'Password1') => (await request(app).post('/api/auth/login').send({ email, password })).body.token;

beforeAll(async () => {
  db = openDb(':memory:');
  app = createApp(db, { secret: 'test' });
  for (const [name, email, role] of [['Admin', 'admin@t.com', 'admin'], ['Mec', 'mec@t.com', 'mecanico'], ['Mec2', 'mec2@t.com', 'mecanico']])
    db.prepare('INSERT INTO users (name,email,password_hash,role) VALUES (?,?,?,?)').run(name, email, bcrypt.hashSync('Password1', 4), role);
  t.admin = await login('admin@t.com'); t.mec = await login('mec@t.com'); t.mec2 = await login('mec2@t.com');
});

describe('autenticación', () => {
  test('login correcto e incorrecto', async () => {
    expect((await request(app).post('/api/auth/login').send({ email: 'admin@t.com', password: 'Password1' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email: 'admin@t.com', password: 'mala' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: 'no@t.com' })).status).toBe(401);
  });
  test('/api/me exige token válido y ya no existe el registro público', async () => {
    expect((await request(app).get('/api/me')).status).toBe(401);
    expect((await request(app).get('/api/me').set(bearer('falso'))).status).toBe(401);
    expect((await request(app).get('/api/me').set(bearer(t.mec))).body.user.role).toBe('mecanico');
    expect((await request(app).post('/api/auth/register').send({ name: 'X', email: 'x@x.com', password: 'Password1' })).status).toBe(404);
  });
});

describe('administración de usuarios (solo admin)', () => {
  test('el admin crea mecánicos y administradores', async () => {
    const r = await request(app).post('/api/admin/users').set(bearer(t.admin)).send({ name: 'Nuevo', email: 'Nuevo@T.com', password: 'Password1', role: 'mecanico' });
    expect(r.status).toBe(201);
    expect(r.body.email).toBe('nuevo@t.com');
    expect(await login('nuevo@t.com')).toBeTruthy();
  });
  test('validaciones, duplicados y permisos', async () => {
    const post = (tk, b) => request(app).post('/api/admin/users').set(bearer(tk)).send(b);
    const ok = { name: 'A', email: 'a@t.com', password: 'Password1', role: 'mecanico' };
    expect((await post(t.admin, { ...ok, role: 'usuario' })).status).toBe(400);
    expect((await post(t.admin, { ...ok, password: '123' })).status).toBe(400);
    expect((await post(t.admin, { ...ok, email: 'mec@t.com' })).status).toBe(409);
    expect((await post(t.mec, ok)).status).toBe(403);
  });
  test('roles y estadísticas', async () => {
    expect((await request(app).get('/api/admin/users').set(bearer(t.mec))).status).toBe(403);
    const users = (await request(app).get('/api/admin/users').set(bearer(t.admin))).body;
    const mec2 = users.find((u) => u.email === 'mec2@t.com');
    const admin = users.find((u) => u.email === 'admin@t.com');
    const patch = (id, role) => request(app).patch(`/api/admin/users/${id}/role`).set(bearer(t.admin)).send({ role });
    expect((await patch(mec2.id, 'admin')).body.role).toBe('admin');
    expect((await patch(mec2.id, 'mecanico')).body.role).toBe('mecanico');
    expect((await patch(mec2.id, 'rey')).status).toBe(400);
    expect((await patch(admin.id, 'mecanico')).status).toBe(400);
    expect((await patch(9999, 'admin')).status).toBe(404);
    expect((await request(app).get('/api/admin/stats').set(bearer(t.admin))).body.usersByRole.length).toBeGreaterThan(0);
  });
});

describe('reparaciones y folio público', () => {
  let repair;
  test('el mecánico registra un coche (sin correo) y recibe folio', async () => {
    const r = await request(app).post('/api/repairs').set(bearer(t.mec)).send(body);
    expect(r.status).toBe(201);
    expect(r.body.folio).toMatch(/^AM-[0-9A-F]{8}$/);
    expect(r.body.status).toBe('recibido');
    expect(r.body.history).toHaveLength(1);
    repair = r.body;
  });
  test('validación y permisos al crear', async () => {
    expect((await request(app).post('/api/repairs').set(bearer(t.mec)).send({ plate: 'X' })).status).toBe(400);
    expect((await request(app).post('/api/repairs')).status).toBe(401);
    expect((await request(app).post('/api/repairs').set(bearer(t.admin)).send({ ...body, year: 'x' })).body.year).toBeNull();
  });
  test('el cliente consulta con el folio sin iniciar sesión y sin ver datos internos', async () => {
    const r = await request(app).get(`/api/track/${repair.folio.toLowerCase()}`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('recibido');
    expect(r.body.make).toBe('Nissan');
    expect(r.body).not.toHaveProperty('mechanic_id');
    expect(JSON.stringify(r.body)).not.toContain('mec@t.com');
    expect((await request(app).get('/api/track/AM-NOEXISTE')).status).toBe(404);
  });
  test('listado: cada mecánico ve lo suyo y el admin todo', async () => {
    expect((await request(app).get('/api/repairs').set(bearer(t.mec))).body).toHaveLength(1);
    expect((await request(app).get('/api/repairs').set(bearer(t.mec2))).body).toHaveLength(0);
    expect((await request(app).get('/api/repairs').set(bearer(t.admin))).body.length).toBeGreaterThanOrEqual(2);
  });
  test('cambio de estatus con historial visible en la consulta pública', async () => {
    const url = `/api/repairs/${repair.id}/status`;
    const r = await request(app).patch(url).set(bearer(t.mec)).send({ status: 'mantenimiento', note: 'Cambiando balatas' });
    expect(r.body.status).toBe('mantenimiento');
    expect((await request(app).get(`/api/track/${repair.folio}`)).body.history).toHaveLength(2);
    expect((await request(app).patch(url).set(bearer(t.mec)).send({ status: 'volando' })).status).toBe(400);
    expect((await request(app).patch(url).set(bearer(t.mec2)).send({ status: 'listo' })).status).toBe(404);
    expect((await request(app).patch(url).send({ status: 'listo' })).status).toBe(401);
  });
  test('solo el admin elimina', async () => {
    expect((await request(app).delete(`/api/repairs/${repair.id}`).set(bearer(t.mec))).status).toBe(403);
    expect((await request(app).delete(`/api/repairs/${repair.id}`).set(bearer(t.admin))).status).toBe(204);
    expect((await request(app).delete(`/api/repairs/${repair.id}`).set(bearer(t.admin))).status).toBe(404);
  });
});

describe('cola de trabajo y costos', () => {
  let a, b;
  const mk = async () => (await request(app).post('/api/repairs').set(bearer(t.mec2)).send(body)).body;

  test('los más antiguos van primero y los entregados al final', async () => {
    a = await mk(); b = await mk(); const c = await mk();
    db.prepare("UPDATE repairs SET created_at = '2020-01-01 00:00:00' WHERE id = ?").run(b.id);
    db.prepare("UPDATE repairs SET created_at = '2019-01-01 00:00:00', status = 'entregado' WHERE id = ?").run(a.id);
    const ids = (await request(app).get('/api/repairs').set(bearer(t.mec2))).body.map((r) => r.id);
    expect(ids).toEqual([b.id, c.id, a.id]);
  });
  test('el mecánico agrega y quita costos; el cliente los ve con el total', async () => {
    const url = `/api/repairs/${b.id}/items`;
    expect((await request(app).post(url).set(bearer(t.mec2)).send({ concept: 'Balatas', amount: 850.5 })).status).toBe(201);
    const r = await request(app).post(url).set(bearer(t.mec2)).send({ concept: 'Mano de obra', amount: '300' });
    expect(r.body.total).toBe(1150.5);
    expect((await request(app).get(`/api/track/${b.folio}`)).body.total).toBe(1150.5);
    const del = await request(app).delete(`${url}/${r.body.items[0].id}`).set(bearer(t.mec2));
    expect(del.body.total).toBe(300);
    expect((await request(app).post(url).set(bearer(t.admin)).send({ concept: 'Extra', amount: 1 })).status).toBe(201);
  });
  test('validaciones y permisos de costos', async () => {
    const url = `/api/repairs/${b.id}/items`;
    for (const bad of [{ concept: '', amount: 1 }, { concept: 'x', amount: -5 }, { concept: 'x', amount: 'abc' }])
      expect((await request(app).post(url).set(bearer(t.mec2)).send(bad)).status).toBe(400);
    expect((await request(app).post(url).set(bearer(t.mec)).send({ concept: 'x', amount: 1 })).status).toBe(404);
    expect((await request(app).delete(`${url}/1`).set(bearer(t.mec))).status).toBe(404);
    expect((await request(app).post(url).send({ concept: 'x', amount: 1 })).status).toBe(401);
  });
});

describe('otros', () => {
  test('rutas inexistentes, JSON inválido y límite de la consulta pública', async () => {
    expect((await request(app).get('/api/nada')).status).toBe(404);
    expect((await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{malo')).status).toBe(400);
    const limited = createApp(openDb(':memory:'), { trackLimit: 2 });
    for (let i = 0; i < 2; i++) await request(limited).get('/api/track/AM-X');
    expect((await request(limited).get('/api/track/AM-X')).status).toBe(429);
  });
  test('migra una base anterior: quita el correo del cliente y las cuentas de usuario', () => {
    const file = path.join(os.tmpdir(), `old-${Date.now()}.db`);
    const old = new Database(file);
    old.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'usuario' CHECK (role IN ('admin','mecanico','usuario')), created_at TEXT);
      CREATE TABLE repairs (id INTEGER PRIMARY KEY AUTOINCREMENT, folio TEXT NOT NULL UNIQUE, customer_email TEXT NOT NULL, mechanic_id INTEGER NOT NULL, plate TEXT NOT NULL, make TEXT NOT NULL, model TEXT NOT NULL, year INTEGER, description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'recibido', created_at TEXT, updated_at TEXT);
      INSERT INTO users (name,email,password_hash,role) VALUES ('M','m@t.com','x','mecanico'), ('C','c@t.com','x','usuario');
      INSERT INTO repairs (folio,customer_email,mechanic_id,plate,make,model,description) VALUES ('AM-1','c@t.com',1,'P','K','R','d');`);
    old.close();
    const migrated = openDb(file);
    expect(migrated.prepare('PRAGMA table_info(repairs)').all().map((c) => c.name)).not.toContain('customer_email');
    expect(migrated.prepare('SELECT role FROM users').all()).toEqual([{ role: 'mecanico' }]);
    expect(migrated.prepare('SELECT folio FROM repairs').get().folio).toBe('AM-1');
    migrated.close(); fs.rmSync(file, { force: true });
  });
});

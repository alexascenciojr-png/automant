const bcrypt = require('bcryptjs');
const { openDb } = require('./db');
const { createApp } = require('./app');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) throw new Error('Define JWT_SECRET en producción');

const db = openDb(process.env.DB_FILE || 'automant.db');

// Cuentas iniciales (cámbialas con variables de entorno)
const seed = [
  ['Administrador', process.env.ADMIN_EMAIL || 'admin@automant.com', process.env.ADMIN_PASSWORD || 'Admin1234', 'admin'],
  ['Mecánico Demo', 'mecanico@automant.com', process.env.MECHANIC_PASSWORD || 'Mecanico1234', 'mecanico'],
];
for (const [name, email, pass, role] of seed) {
  if (!db.prepare('SELECT 1 FROM users WHERE email = ?').get(email))
    db.prepare('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)')
      .run(name, email, bcrypt.hashSync(pass, 10), role);
}

const port = process.env.PORT || 3000;
createApp(db, { secret: process.env.JWT_SECRET }).listen(port, () => console.log(`AutoMant en http://localhost:${port}`));

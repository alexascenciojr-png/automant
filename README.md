# AutoMant

Seguimiento de reparaciones para talleres. El mecánico registra el coche, se genera un **folio** y el cliente consulta el **estatus** con él.

**Stack:** Node.js · Express · SQLite · JWT · HTML/CSS/JS sin frameworks · Jest.

## Ejecutar

```bash
npm install
npm start          # http://localhost:3000
npm test           # pruebas + cobertura (mínimo 80 %)
```

Cuentas iniciales (cámbialas con `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `MECHANIC_PASSWORD`):

| Rol | Correo | Contraseña |
|---|---|---|
| Administrador | admin@automant.com | Admin1234 |
| Mecánico | mecanico@automant.com | Mecanico1234 |

No hay registro de clientes: el administrador crea las cuentas del taller (pestaña *Usuarios y roles*). El cliente **no necesita cuenta**, solo consulta su coche con el folio.

## Roles

| Acción | Cliente (sin cuenta) | Mecánico | Admin |
|---|:-:|:-:|:-:|
| Consultar estatus y costos con el folio | ✓ | ✓ | ✓ |
| Registrar coche (genera folio) y cambiar estatus | | ✓ (los suyos) | ✓ (todos) |
| Agregar costos a la reparación | | ✓ | ✓ |
| Eliminar reparaciones | | | ✓ |
| Crear usuarios, cambiar roles, ver resumen | | | ✓ |

Estatus: Recibido → Diagnóstico → En mantenimiento → Esperando refacciones → Listo para entrega → Entregado.

## Estructura

```
src/app.js      API (rutas, JWT, roles)      tests/       pruebas Jest
src/db.js       esquema SQLite               public/      interfaz (estilo Apple)
src/server.js   arranque y cuentas iniciales .github/     pipeline CI/CD
docs/INFORME.md informe de cierre
```

## CI/CD (GitHub Actions)

`test` (Jest ≥ 80 %) → `sonar` → `zap` → `deploy`. Secrets: `RENDER_DEPLOY_HOOK`, `SONAR_TOKEN`, `SONAR_HOST_URL` y la variable `SONAR_ENABLED=true`.
En Render: Build `npm install`, Start `npm start`, variables `NODE_ENV=production` y `JWT_SECRET`.

# Informe de cierre: AutoMant

> Las columnas "Ejecutado" y las métricas de ZAP/SonarQube se completan con los resultados reales de tu pipeline.

## 1. Planificado vs. ejecutado

| Fase | Planificado | Ejecutado |
|---|---|---|
| Implementación y seguridad | Módulo con JWT, roles y pruebas ≥ 80 % (4 h) | Módulo de reparaciones con folio, roles admin/mecánico, consulta pública por folio, JWT, pruebas automáticas con más de 90 % de cobertura. Se migró de Android (Kotlin/Room) a web (Node/SQLite). |
| CI/CD | Pipeline con despliegue a pruebas | `.github/workflows/ci.yml`: test, sonar, zap, deploy. |
| Pruebas de seguridad | Escaneo OWASP ZAP | Job `zap` (baseline). Hallazgos: _pendiente de la primera corrida_. |
| Calidad | Análisis SonarQube | `sonar-project.properties`. Deuda técnica, code smells y duplicación: _pendiente de la primera corrida_. |
| Cierre | Informe y plan de mejora | Este documento. |

Desviación principal: la app original era local a Android, sin backend ni usuarios, por lo que se migró para poder cumplir JWT, CI/CD y ZAP.

## 2. Lecciones aprendidas

- Sin documentación ni contacto con el equipo, reconstruir el estado del proyecto exigió leer el código completo.
- Una app solo local no permite roles, autenticación ni pruebas de seguridad: la arquitectura debe definirse según los requisitos.
- Escribir pruebas junto con las rutas detectó errores de permisos (por ejemplo, un mecánico editando reparaciones ajenas).
- Sin registro público, solo el administrador crea cuentas; el cliente consulta con un folio aleatorio y la ruta pública tiene límite de intentos.

## 3. Medidas de seguridad aplicadas

Consultas parametrizadas (contra SQLi), renderizado con `textContent` (contra XSS), contraseñas con bcrypt, JWT con expiración de 8 h, límite de intentos en login, cabeceras con Helmet y validación de entradas.

## 4. Plan de mejora continua

1. Notificaciones por correo o WhatsApp cuando cambie el estatus.
2. Fotos y cotizaciones por reparación.
3. Migrar SQLite a PostgreSQL y agregar pruebas end-to-end.
4. Predicción de mantenimientos y refacciones con IA a partir del historial.
5. Revisar mensualmente los reportes de ZAP y SonarQube.

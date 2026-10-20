# Instrucciones de desarrollo de FLOW WAR para Codex y otros agentes

## Rama de integración
- `develop` es la **única rama de integración de desarrollo**. Antes de comenzar cualquier tarea, consulta el HEAD actualizado de `origin/develop` y trabaja a partir de ese commit, no de `main` ni de una entrega antigua.
- Para tareas grandes, crea una rama de trabajo temporal desde `develop` (por ejemplo, `codex/entrega-6-backend-security-ai`) y, tras completar las pruebas y la revisión, integra sus cambios **en `develop`** mediante pull request. Una rama de tarea no sustituye la rama común.
- Si el usuario pide trabajar directamente en `develop`, verifica su HEAD y evita sobrescribir trabajo concurrente; no uses force-push.
- Cada nueva tarea debe incorporar lo ya integrado en `develop`. Antes de fusionar otra rama, compara el historial: si es antecesora, no repitas el merge.
- **No cambies `main`**, no abras PR a `main`, no cambies la rama por defecto y no promociones `develop` a producción sin una instrucción explícita del usuario.
- No elimines ramas históricas; consérvalas para auditoría.

## Calidad y seguridad
- Ejecuta `npm test` y `npm run build` antes de presentar una entrega. Ejecuta los benchmarks y pruebas específicos que correspondan a los cambios; no afirmes haberlos ejecutado sin evidencia.
- Conserva el motor económico determinista, cinco empresas, 5,000 clientes, aislamiento entre empresas, FlowSlack privado, recuperación transaccional, snapshots optimizados y DVR configurable.
- Cualquier salida de IA debe pasar validaciones y permisos del servidor. Nunca publiques secretos ni introduzcas cambios de comportamiento no solicitados.
- Si aparecen conflictos de integración, resuélvelos preservando funcionalidad y pruebas; no descartes versiones de archivos a ciegas.
- Al finalizar, informa el SHA base de `develop`, SHA final integrado, ramas involucradas, pruebas realizadas y riesgos pendientes.

## Estado al instituir la rama
- La rama `develop` se creó a partir del commit `6289e902eb8a4a114fcfe204fe19379ff1ca50db` de `codex/entrega-5-5-performance-modes`, que ya contiene por ascendencia las entregas anteriores.
- Este archivo establece la política de trabajo futuro; no implica que la Entrega 6 esté implementada.

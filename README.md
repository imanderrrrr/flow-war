# FLOW WAR — simulador arcade de calidad de software

Especificación para una práctica universitaria competitiva de calidad de software: cinco empresas de comercio electrónico, roles separados y consecuencias visibles en una arquitectura de estilo arcade 8-bit.

**El proyecto es ejecutable.** Incluye la arena, interfaces privadas, editores conectables y pipeline multirrol. La [Entrega 2](docs/08-entrega-2-trafico-colas.md) integra tráfico individual, FIFO, capacidad, abandono y contabilidad real, conservando el escenario de concurrencia de Entrega 1. La [Entrega 3](docs/09-entrega-3-clientes-migracion.md) añade 5,000 clientes persistentes, migración competitiva, fidelidad visual y cascadas por redistribución real de demanda. Los documentos de diseño describen también ampliaciones pendientes.

```sh
npm install --include=optional --prefer-online
npm run dev
```

Abrir [http://localhost:4173](http://localhost:4173). Las credenciales locales se generan en `.local/access.json`; la de `Docente` abre la consola para iniciar la partida. Para verificar: `npm test` y `npm run build`.

![Arena de FLOW WAR con arquitectura, tráfico y métricas de una empresa](docs/images/arena.png)

## Documentos

| Documento | Contenido |
| --- | --- |
| [Arquitectura y contratos](docs/01-arquitectura.md) | Arquitectura general, componentes, modelo de datos, matriz de permisos, pipeline, sincronización y estructura de carpetas. |
| [Pantallas y componentes](docs/02-pantallas.md) | Pantalla proyectada, cinco interfaces privadas, Producto opcional, controles y dirección visual. |
| [Motor de simulación](docs/03-motor.md) | Tráfico, semántica de bloques, incidentes, migración, economía, métricas y final de partida. |
| [Etapas y criterios de aceptación](docs/04-implementacion.md) | Orden de construcción, alcance del primer prototipo, verificaciones y límites. |
| [Ejecutar el prototipo](docs/05-prototipo.md) | Inicio, acceso por rol, funciones implementadas, limitaciones y verificación. |
| [Auditoría de fidelidad](docs/06-auditoria-fidelidad.md) | Hallazgos verificados y orden de mejora progresiva del motor. |
| [Entrega 1: concurrencia](docs/07-entrega-1-concurrencia.md) | Escenario de solicitudes individuales, persistencia, límites y verificación manual por roles. |
| [Entrega 2: tráfico y colas](docs/08-entrega-2-trafico-colas.md) | Motor ordinario individual, capacidad, FIFO, deadlines, QA, recuperación, ensayos y verificación manual. |
| [Entrega 3: clientes y migración](docs/09-entrega-3-clientes-migracion.md) | Población individual, fidelización, esquema 4, eliminación y ensayos de cascada de 20/25 minutos. |

## Decisiones centrales

- Sesión de 25 minutos por defecto, configurable a 20 minutos antes de comenzar.
- Cinco empresas con 20% de mercado, recursos idénticos y un cliente visible inicial por empresa.
- React + TypeScript + Vite; Zustand para estado de interfaz; React Flow para los editores; Canvas 2D para el tráfico.
- Node.js + Express + Socket.IO; un servidor autoritativo calcula el juego y verifica cada acción.
- Flujo obligatorio: **Backend / Seguridad → QA → CTO → DevOps → producción**. Producto seguirá el mismo flujo cuando se habilite.
- Un bloque solo afecta las solicitudes que pasan por él. Sus conexiones y configuración tienen efectos funcionales.
- Los 5,000 clientes se conservan entre propietarios y el pool sin servicio; visitas reales determinan fidelidad y color persistente.
- La interfaz muestra datos, eventos, resultados de pruebas y consecuencias. No incluye ayudas, recomendaciones ni evaluación del plan.

## Cobertura de la solicitud

| Entregable solicitado | Ubicación |
| --- | --- |
| 1. Arquitectura general | Documento 01, sección 1 |
| 2. Modelo de datos | Documento 01, sección 3 |
| 3. Diagrama de componentes | Documento 01, sección 2 |
| 4. Lista de pantallas | Documento 02 |
| 5. Matriz de permisos | Documento 01, sección 4 |
| 6. Estados del pipeline | Documento 01, sección 5 |
| 7. Diseño del motor | Documento 03 |
| 8. Implementación por etapas | Documento 04 |
| 9. Estructura de carpetas | Documento 01, sección 8 |

Los diagramas usan Mermaid. Las fórmulas y valores de balance pertenecen a la documentación para desarrollo; no se presentan como instrucciones a los jugadores.

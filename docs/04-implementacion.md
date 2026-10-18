# FLOW WAR — etapas y criterios de aceptación

## 1. Alcance del primer prototipo jugable

El primer prototipo completo comprende:

- Cinco empresas seleccionables, con igualdad inicial y 20% de mercado.
- Arena top-down de estilo 8-bit, tráfico, colas, errores y eventos arcade.
- Acceso separado de CTO, Backend, Seguridad, QA y DevOps para cada empresa.
- Dos editores visuales con piezas arrastrables, configurables y conectables.
- Pipeline real Backend/Seguridad → QA → CTO → DevOps → producción.
- Pruebas simuladas con resultados reproducibles y decisión humana.
- Incidente de seguridad e incidente de concurrencia con efectos operativos.
- Presión de abandono, reputación, economía y migración conservativa.
- Color de origen y transformación gradual de clientes migrados.
- Infraestructura manual, presupuesto autorizado, balanceador, Rolling y Restart Replace.
- Sesión de 20 o 25 minutos, eliminación y clasificación final.
- Reconexión sin duplicar acciones y recuperación del servidor en pausa.

Producto, sonido, Blue-Green y autoscaling son ampliaciones. El diseño contempla sus límites de permisos y comportamiento; no son necesarios para cerrar el núcleo solicitado.

## 2. Etapas de construcción

Cada etapa deja una entrega comprobable. Las etapas intermedias son cortes de desarrollo; el nombre “primer prototipo jugable” se reserva al conjunto que cumpla el alcance anterior.

| Etapa | Trabajo | Entrega y condición para avanzar |
| --- | --- | --- |
| 0. Diseño | Arquitectura, modelo, pantallas, permisos, motor, estados y criterios. | Esta documentación; decisiones rastreables y sin contradicciones de dominio. |
| 1. Base de sala | Workspaces TypeScript, contratos, servidor, persistencia, credenciales y rutas por rol. | Cinco empresas y 25 sesiones privadas; ningún rol puede emitir comandos ajenos. |
| 2. Motor mínimo | Reloj fijo, demanda, servicios, inventario, pagos, métricas y ledger. | Un escenario determinista reproduce contadores; aún no es la entrega jugable completa. |
| 3. Arena | Canvas top-down, tarjetas de empresa, sprites, colas y eventos. | Cambiar foco conserva estado; la escena representa datos del motor. |
| 4. Editores | Catálogo de siete piezas Backend y seis de Seguridad, grafos y compilador de ruta. | Conectar/desconectar o reordenar cambia la ejecución aislada; mover posición no cambia resultados. |
| 5. Pipeline | Artefactos inmutables, suites, decisiones, reservas, revisiones y despliegues. | Recorrido completo entre cuatro dispositivos/roles, con efectos solo tras publicación. |
| 6. Competencia | Oleadas, concurrencia, presión, migración, color, colapso y final. | Las cinco empresas compiten; el mercado se conserva y una receptora puede saturarse. |
| 7. Cierre del MVP | Reconexión, recuperación, controles docentes, balance y ensayo de clase. | Cumple todos los criterios obligatorios, incluidos 20–25 min y rendimiento medido. |
| 8. Ampliaciones | Producto, Blue-Green, autoscaling, sonido y escenarios adicionales. | Cada función conserva el pipeline y la igualdad inicial; se habilita por escenario. |

No se fijan plazos sin medir un primer corte de implementación. Las dependencias son secuenciales por dominio: la arena necesita métricas; los editores necesitan intérprete; el pipeline necesita permisos y artefactos; el balance necesita el motor completo.

## 3. Criterios de aceptación funcionales

| ID | Caso | Resultado requerido |
| --- | --- | --- |
| AC01 | Iniciar una sala | Cinco empresas con recursos iguales, 20% cada una y una solicitud inicial visible por empresa. |
| AC02 | Abrir la ruta de otro rol o empresa | Acceso denegado; no se reciben sus datos ni controles. |
| AC03 | Backend intenta desplegar por socket | `FORBIDDEN`; producción y capital no cambian. |
| AC04 | Pieza conectada frente a desconectada | Solo las piezas recorridas afectan las solicitudes. |
| AC05 | Reordenar Auth y Role Check | El contexto y los rechazos reflejan el orden real. |
| AC06 | Enviar a QA | Se crea artefacto inmutable; no cambia producción. |
| AC07 | Ejecutar una suite | Resultados del intérprete aislado; producción, dinero y mercado intactos. |
| AC08 | Aprobar QA | Avanza al CTO; no autoriza dinero ni despliega. |
| AC09 | CTO autoriza | Reserva dinero disponible, sin publicar. |
| AC10 | DevOps despliega artefacto autorizado | Producción cambia al artefacto exacto y aplica la curva de disponibilidad elegida. |
| AC11 | Cambia producción mientras otro cambio está pendiente | El otro queda `STALE`; no reutiliza sus pruebas o autorizaciones sobre una base nueva. |
| AC12 | Se corrige un artefacto rechazado | Nueva revisión; requiere QA y CTO nuevamente. |
| AC13 | Dos aprobaciones compiten por el mismo saldo | Nunca se reserva más dinero del disponible; una decisión se rechaza si ya no alcanza. |
| AC14 | Se reenvía un comando por pérdida de ACK | Mismo resultado y un solo cargo/efecto. |
| AC15 | Cae la conexión de un participante | Conserva su rol al volver y sincroniza antes de actuar. |
| AC16 | Aparece tráfico malicioso | Los controles operan sobre solicitudes concretas; hay saturación, bloqueos o accesos indebidos según el recorrido. |
| AC17 | Varias compras leen el mismo stock | La escritura insegura puede producir sobreventa; el comportamiento atómico o serializado responde a sus operaciones. |
| AC18 | Un cliente migra | Origen pierde uno, destino gana uno y el color previo se conserva al entrar. |
| AC19 | Cliente migrado recibe servicio satisfactorio | Su mezcla cambia gradualmente al color del destino. |
| AC20 | Una receptora adquiere mucho mercado | Aumenta su demanda y puede generar nuevas colas, errores y presión. |
| AC21 | Empresa cumple condiciones de eliminación | Sale, conserva datos finales y transfiere clientes a supervivientes. |
| AC22 | No quedan supervivientes | Finaliza con pool `SIN SERVICIO`; no se asigna ganador artificial. |
| AC23 | Pausar y reanudar | Reloj, cargos, QA, deadlines y vencimientos no avanzan durante la pausa. |
| AC24 | Reiniciar host y recuperar sala | Replay reproduce último estado confirmado; la sala vuelve pausada. |
| AC25 | Completar partida | Clasificación y desempates verificables, con métricas congeladas. |

## 4. Verificaciones de dominio

Las siguientes verificaciones se implementarán junto al código; no están ejecutadas en esta entrega documental.

- **Permisos:** cubrir cada acción permitida y rechazada por rol, empresa y estado. Comprobar payloads sanitizados, además de botones ausentes.
- **Pipeline:** recorrer camino normal, rechazos, expiración, cambio de base, doble clic, despliegues simultáneos y rollback autorizado.
- **Dinero:** comparar ledger, reservas y saldo disponible; jamás duplicar cargo o gastar una reserva ajena. Verificar conciliación de reservas cuando pérdidas involuntarias reducen su respaldo.
- **Mercado:** generar secuencias de migración/eliminación y verificar propietario único, conservación de población y porcentajes mostrados.
- **Grafos:** demostrar que conectividad y orden alteran ejecución; nodos desconectados no conceden efectos. Limitar parámetros, ciclos y expansión de reintentos.
- **Concurrencia:** usar fixtures de compras intercaladas que reproduzcan sobreventa y contrastarlos con escrituras atómicas/locks. No basta afirmar que existe un bloque en el grafo.
- **QA:** ejecutar el mismo artefacto/base/seed dos veces y comparar observaciones, sin contaminación de producción.
- **Determinismo:** comparar hash de estado para un journal repetido; incluir PRNG, colas, trabajos, acumuladores fraccionales y costos.
- **Reconexión:** interrumpir la red antes y después de persistir un comando; comprobar el mismo ID, un solo efecto y recuperación de proyección correcta.
- **Ensayo multirrol:** completar el pipeline desde cuatro sesiones de la misma empresa; probar que otro equipo no puede aprobarlo o desplegarlo.

Toolchain prevista: Vitest para dominio e integración del servidor y Playwright para los recorridos reales del navegador. No se necesita una batería que replique cada detalle de presentación; se verifican los comportamientos con impacto en el juego.

## 5. Validación de balance y rendimiento

El balance se evaluará con escenarios reproducibles, sin añadir sugerencias a la interfaz de jugadores:

| Escenario de ensayo | Lo que se medirá |
| --- | --- |
| Cinco empresas sin intervención | Evolución de colas, presión, capital y eliminación. Determina si hay tiempo suficiente para reaccionar. |
| Cinco empresas con la misma secuencia técnica | Simetría de condiciones y ausencia de ventaja por ID o foco de cámara. |
| Una empresa mantiene servicio y otras fallan | Migración, cuota, saturación de la receptora y posible cascada. |
| Cambio ineficaz publicado | Despliegue técnicamente completado con consecuencias funcionales observables. |
| QA acepta una suite insuficiente | El motor no corrige el plan ni aplica pruebas omitidas automáticamente. |
| Presupuestos y reservas agotados | Degradación por falta de operación autorizada, sin deuda o gasto cruzado. |
| Partida completa a 25 min | Duración, ritmo de incidentes, necesidad de coordinación y ausencia de bloqueo del pipeline. |
| 27 clientes conectados; luego 32 | Latencia de comandos, duración de ticks, ancho de banda y FPS. |

Metas iniciales: recorrido coordinado QA → CTO → DevOps en 20–40 s de interacción, tick p95 menor a 50 ms, ACK p95 menor a 250 ms en la LAN objetivo y arena de al menos 30 FPS. Se documentará hardware, navegador, número de conexiones y semilla al reportar resultados.

Los valores de costos, tasas, capacidades, reputación y presión deben ajustarse con estos ensayos. Los ajustes se versionan en el escenario antes del inicio; no se cambian silenciosamente durante una partida.

## 6. Límites de alcance

- El simulador representa solicitudes y consecuencias, no ejecuta ataques de red ni despliega infraestructura real.
- No hay evaluación del plan, recomendaciones de piezas, selección automática de pruebas ni reparación automática.
- El editor inicial admite cadenas ejecutables y salidas terminales, no un lenguaje general de programación visual.
- No hay edición colaborativa simultánea del mismo borrador; se resuelven conflictos por revisión.
- El backend inicial tiene un único proceso autoritativo. Distribución entre hosts o varias salas a gran escala requiere otro diseño operativo.
- No se incluye integración con repositorios, CI/CD externos, pagos reales ni cuentas universitarias.
- La recuperación protege el estado confirmado; un corte del host pausa la partida hasta reanudación del docente.

## 7. Estado de la entrega inicial de diseño

La primera entrega fue documental, conforme al alcance entonces solicitado: solo diseño técnico. A partir de la solicitud posterior de construir la interfaz, se implementó un primer prototipo. Su estado verificable y diferencias respecto a este diseño se documentan en [ejecución del prototipo](05-prototipo.md).

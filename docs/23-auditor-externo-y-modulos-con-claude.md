# Auditor externo y módulos de Backend redactados con Claude

Dos agregados que se conectan entre sí. Todo sigue siendo simulado y textual: nadie escribe ni ejecuta código, y
cada "prueba" es un conjunto de contadores del motor.

1. **Auditor externo** (sin IA): quienes quedan en la reserva al formar los equipos auditan los módulos en
   producción de las cinco empresas y lanzan **pruebas de control** con **tráfico anómalo simulado**.
2. **Módulos redactados con Claude** (solo Backend): el estudiante describe un módulo en palabras, Claude redacta un
   diseño textual breve y el servidor deja a propósito algunos **controles pendientes**. Seguridad puede agregar los
   controles, QA puede detectarlos en staging y lo que nadie atrape llega a producción, donde lo ven los auditores.

## 1. Auditor externo

### Quién es auditor

- Después de **FORMAR EQUIPOS**, cada jugador que no quedó sentado en una empresa es auditor automáticamente
  (`server/lobby.ts`, `participantIdentity`). En la pantalla de sala la fila se llama **AUDITORES EXTERNOS** y el
  celular muestra "SOS AUDITOR EXTERNO".
- Si el docente mueve a un auditor a una empresa (asistente de sala), deja de ser auditor; el integrante desplazado
  pasa a la reserva y se vuelve auditor.
- La identidad es `{ id: 'auditor-P<n>', role: 'auditor', companyId: null }`. No es un rol de empresa: no está en
  `ROLES`, no tiene registro de empleado, no recibe disciplina por empresa, no usa Claude, FlowSlack ni el DVR, y no
  tiene credencial en `access.json` (solo existe a través de la sala).

### Espacio de trabajo (`/workspace`, pensado para celular)

1. **Empresa**: las cinco, con la cantidad total de controles pendientes.
2. **Módulos en producción**: los bloques de la ruta del Backend publicado (`c.backend`), en orden, con su versión.
3. **Controles pendientes** del módulo elegido, calculados de la configuración real (`server/auditor.ts`,
   `pendingControls`). Ejemplo: "Este módulo no tiene validación de entrada".
4. **LANZAR PRUEBA** sobre un control pendiente.
5. **Contadores en vivo**: enviadas, contenidas, no contenidas (y "sin servicio" si la empresa estaba en
   mantenimiento o con la cola llena).

| Control pendiente | Texto | Categoría del tráfico anómalo simulado |
| --- | --- | --- |
| Auth | Este módulo no verifica la sesión del cliente. | Identidad no verificada (`forged`) |
| Role Check | Este módulo no comprueba que la compra sea de quien la pide. | Identidad no verificada (`forged`) |
| WAF | Este módulo no tiene validación de entrada. | Entrada inválida (`injection`) |
| Bot Detection | Este módulo no distingue solicitudes automatizadas. | Solicitudes automatizadas (`bot`) |
| Rate Limit | Este módulo no limita la cantidad de solicitudes. | Solicitudes automatizadas (`bot`) |

IP Block no aparece: protege un único origen sintético y no corresponde a una categoría completa.

Un control **no** figura como pendiente en un módulo cuando:

- Seguridad lo configuró en ese bloque (`blockPolicies` de la versión publicada), o
- la versión tiene una protección que cubre a todos los módulos (configuración heredada `security.prepare` o el grafo
  de seguridad heredado), o
- es un módulo redactado con Claude y su **diseño público** declara ese control (los controles pendientes que eligió
  el servidor son los únicos que le faltan).

La lista se calcula **solo con controles configurados y con el diseño público** de los módulos: nunca lee los defectos
simulados ocultos de un módulo creado con `module.create`. Si una empresa tiene un módulo de compra sembrado, la lista
muestra sus controles como pendientes aunque el motor los contenga; averiguar si de verdad se contienen requiere lanzar
la prueba, igual que QA debe ejecutar su suite.

### La prueba de control

- Es el comando `audit.probe` `{ companyId, nodeId, check }`, que entra por el **mismo pipeline** que cualquier
  orden: validación estricta, idempotencia por ID, group commit y ACK después del COMMIT. Se registra en el historial y
  se reconstruye en el DVR como cualquier comando.
- **Duración 30 s y espera 60 s, en tiempo de juego**, validadas en el servidor: no se puede lanzar otra prueba
  mientras la anterior sigue en curso ni antes de que pasen 60 s desde su fin. Con la partida en pausa el tiempo no
  corre. Cada auditor tiene su propia espera.
- Como máximo **2 pruebas de control simultáneas por empresa** (`COMPANY_BUSY`), para que varios auditores no
  acumulen tráfico anómalo sobre la misma empresa.
- La prueba envía **30 solicitudes, una por segundo** (el mismo tamaño que la suite Seguridad de QA). Cada una es
  tráfico anómalo del motor (`admitTraffic(..., 'purchase', 'malicious', categoría)`), igual que el tráfico anómalo
  periódico. **Las reglas existentes deciden qué se contiene** (`admitSecurity`): controles por bloque en cualquier
  módulo de la ruta, protección de toda la versión y módulos de compra. Por eso un WAF en Read Stock contiene una
  prueba lanzada sobre Write Stock.
- Contenida = la admisión de seguridad la rechazó. No contenida = pasó los controles; sus consecuencias son las del
  motor (accesos indebidos, reputación, presión), como el resto del tráfico anómalo.

### Qué le pasa al sistema de la empresa

La prueba no se queda en un contador: el servidor **sigue cada solicitud** y arma el relato con hechos del motor
(nunca con texto de un modelo). El auditor ve, en vivo:

| Dato | Qué significa |
| --- | --- |
| Contenidas y **dónde** | Qué control actuó y en qué módulo, aunque sea **otro**: "el control WAF configurado en Read Stock lo detiene antes de llegar a Write Stock", "el módulo Inicio de sesión verifica Auth por su cuenta", "el control Rate Limit de toda la versión lo detiene". |
| Hasta dónde llegan | El punto más profundo al que llega el tráfico que pasó: la tienda, el checkout o Write Stock (el inventario). |
| Accesos indebidos | Cuántas llegaron a Write Stock y provocaron un acceso indebido: la empresa registra SECURITY BREACH y pierde reputación. |
| Compras logradas | Cuántas completaron una compra como si fueran clientes. |
| Rechazadas o abandonadas | Cuántas entraron pero se detuvieron después (sin stock, cola llena) o vencieron por espera. |

El relato distingue el módulo que el auditor eligió del control que realmente actuó, así que una lista de controles
pendientes por módulo nunca se confunde con la contención real, que es de toda la ruta de compra.
- Se valida en el servidor: rol auditor, partida en curso, empresa en juego, módulo en la versión publicada y control
  todavía pendiente (si Seguridad lo agregó mientras tanto: `NOT_PENDING`).
- Si la empresa sale de la partida, la prueba se detiene; al terminar la partida, también.

### Privacidad

- La proyección del auditor (`Snapshot.auditor`) contiene solo: por empresa, nombre, color, versión, si sigue en
  juego y sus módulos con controles pendientes; y las pruebas del propio auditor. No recibe `privateCompany`,
  `operations`, cambios, FlowSlack, eventos privados ni datos de otros auditores.
- La empresa ve el evento **"Tráfico inusual entrante · {categoría} · 30 s."** y al final **"Tráfico inusual
  finalizado · N contenidas, M no contenidas."**, sin el nombre ni el ID del auditor. En el historial la acción figura
  con actor `auditor`; el registro completo solo lo ve el docente.
- Las órdenes del auditor se registran **acotadas a la empresa objetivo**, con el tipo fijo `audit.probe` (o
  `audit.rejected`) y sin texto del cliente, y solo cuando se ejecutan: ninguna otra empresa las ve en su historial.
- Endpoints de empleados (`/api/ai/execute`, `/api/ai`, `/api/flowslack`, DVR) responden 403 al auditor.

### Consecuencias: el hallazgo y el sangrado

Una prueba cuyo tráfico **no fue contenido** deja un **hallazgo** registrado sobre (empresa, módulo, control).
Confirmarlo cuesta una **multa única de Q250**; volver a probar el mismo hueco no abre otro hallazgo ni cobra de
nuevo. Seguridad y el CTO lo ven en su espacio con el módulo, el control que falta y los accesos registrados, y
entra una alerta en `#alertas-sistema`, siempre sin el nombre del auditor.

Mientras el hallazgo siga abierto **es una fuga**: cada solicitud anómala de esa categoría que los controles no
contienen le cuesta a la empresa Q1 y 0,02 puntos de reputación. Como ese tráfico crece durante toda la partida,
el daño crece solo: al principio son unos Q54 y un punto de reputación por minuto; al final, unos Q360 y siete
puntos. No hay escalada programada — **la escalada es la curva de tráfico**.

El hallazgo **se cierra solo** cuando ese control deja de estar pendiente, o sea cuando Seguridad lo configura y el
cambio llega a producción. Ahí para el sangrado. Lo que mata no es el auditor: es no arreglar el hueco.

Medición en `docs/benchmarks/auditoria/README.md`: corregirlo a los dos minutos cuesta Q378 y deja a la empresa
igual que si nunca la hubieran auditado; ignorarlo hasta el final la deja con reputación cero y 27 % menos clientes
que una empresa sin auditar.

### La prueba sostenida

Sobre un hallazgo abierto, el auditor puede sostener el tráfico durante **60 s**, con una espera de 120 s. Dos topes
la mantienen **no letal por construcción**: la tasa nunca pasa de un tercio de la capacidad web de esa empresa —así
que escalar servidores sirve de verdad— y no se admite ninguna solicitud si la cola del servicio objetivo ya va por
encima de dos tercios, de modo que los clientes legítimos siempre tienen lugar.

El tráfico entra por el servicio del módulo auditado, así que el embudo que aparece en el mapa delata dónde está el
hueco. Y lo que el auditor puede hacer adentro depende del módulo:

| Módulo auditado | Qué hace durante la ventana |
| --- | --- |
| **Request IN** | Solo volumen sobre la cola de entrada: sube la latencia y aparecen rechazos |
| **Read Stock** | Suspende el reabastecimiento: el inventario escasea |
| **Write Stock** | **Deja el inventario en cero**: las ventas se frenan hasta que la ventana cierra |
| **Payment** | Las compras legítimas se completan pero no se cobran: el ingreso se pierde |
| **Response OUT** | El cliente recibe un fallo aunque ya se le cobró |

Todo se revierte solo al cerrarse la ventana, por tiempo, por cierre del hallazgo o porque la empresa salió de la
partida.

### Cómo se entera la empresa

Por donde se enteraría de verdad: **clientes molestos**. Las quejas de `soporte-clientes` están redactadas como las
escribiría una persona, incluida la señal de que antes funcionaba —«hace un rato me dejaba comprar y ahora dice que
no hay», «antes era instantáneo, ahora se tarda un montón», «me deja a medias y se cae, llevo tres intentos»— y
caen además como **notificaciones estilo mensaje de texto** sobre el espacio de trabajo, apiladas y pasajeras. Se
pueden silenciar sin perder nada: el canal conserva todas.

Ese es el ciclo: caen quejas → el equipo pregunta qué pasa → Seguridad corre sus pruebas y encuentra el control que
falta → le pide a Claude que lo configure → el hallazgo se cierra.

## 2. Módulos de Backend redactados con Claude

### Recorrido

1. Backend escribe en su panel de Claude, por ejemplo **"Necesito un módulo de inicio de sesión"**.
2. Claude (Haiku 5.5, mismo AiGateway y ejecutor) llama `backend_disenar_modulo` con un **diseño textual breve**:
   nombre, de 1 a 6 componentes (usuario, contraseña, token…) y una o dos frases. No escribe código.
3. El servidor:
   - exige un verbo de pedido en la instrucción, la palabra "módulo", citas literales y que el nombre comparta una
     palabra con lo que escribió el estudiante; una pregunta nunca cambia el estado;
   - rechaza diseños con código, consultas, marcas o configuraciones (`server/design.ts`, `sanitizeDesign`);
   - **elige los controles pendientes**: `designPending(seed, nombre, componentes)`, una función pura del seed de la
     partida y del diseño (sin mayúsculas ni tildes), con tres resultados posibles: `[WAF]`, `[Auth, Role Check]` o
     `[Auth, Role Check, WAF]`;
   - envía el comando `module.design` `{ name, components, summary, pending }` por el pipeline. Al aplicarlo, el motor
     **vuelve a calcular la elección y rechaza cualquier otra**: ni el modelo ni la interfaz pueden elegir.
4. El módulo se crea como módulo de compra (`purchase`, no idempotente) con los defectos simulados que el motor ya
   modela: Auth/Role Check pendientes → D05, WAF pendiente → D08 (perfil `design-1`). Se agrega al borrador, se entrega
   a Seguridad como cualquier `module.create` y bloquea la implementación hasta la devolución formal de QA.
5. La respuesta al estudiante muestra el diseño de Claude y el hecho del motor ("Módulo C0-M1 agregado al borrador y
   enviado a Seguridad (CH-001)"). No dice qué controles quedaron pendientes.

La elección viaja en el payload del comando, por lo que la economía sigue siendo reproducible: reaplicar el mismo
comando da el mismo módulo, y un diseño idéntico da los mismos pendientes en cualquier empresa.

### Qué hace cada departamento después

| Departamento | Qué puede hacer |
| --- | --- |
| Seguridad | Agregar el control que falta en el módulo (o en otro bloque de la ruta) con `security.configure`. |
| QA | La suite **Seguridad** (30 solicitudes de entrada inválida) detecta WAF pendiente. Auth/Role Check pendientes se detectan con un escenario de seguridad con identidad falsificada (`qa_ejecutar_escenario`, ataque `forged`). Puede devolver el cambio a Backend con su carta formal. |
| Producción | Lo que nadie atrapa se publica. Los auditores ven el módulo con su nombre y sus controles pendientes, y sus pruebas de control lo confirman. |

### Solo Backend relaja la regla del ejecutor

- `systemFor('backend')` agrega una excepción al prompt: redactar un diseño textual breve, sin código ni controles.
- El resto de los roles usa `EXECUTOR_SYSTEM` sin cambios y no tiene la herramienta; si Seguridad la invoca se
  rechaza como `FUERA_DE_ROL` sin infracción.

## Verificación

- `tests/auditor.test.ts`: reserva → auditor, proyección sin datos privados, 30 solicitudes en 30 s y contadores,
  contención por controles en otro módulo, duración y espera en tiempo de juego (también con pausa), validación de
  comandos e identidades, idempotencia, persistencia, reconstrucción del historial, empresa eliminada, RESTABLECER,
  el relato de lo que le pasa al sistema (entrada, alcance y accesos indebidos), qué control detiene el tráfico y
  dónde, que la lista no revela defectos ocultos de módulos sembrados, el tope de 2 pruebas por empresa y que una
  orden de auditor no llega a otra empresa.
- `tests/module-design.test.ts`: diseño con componentes y defectos elegidos por el servidor, determinismo y rechazo
  de pendientes elegidos por el cliente, diseños con código o ajenos a lo pedido, preguntas, solo Backend con la
  excepción, QA detecta WAF pendiente y devuelve, Seguridad lo corrige, y un pendiente no detectado llega a
  producción donde el auditor lo confirma.
- `tests/auditor-server.test.ts`: servidor real con 26 celulares y una API de Messages local (sin gasto): auditor por
  socket, privacidad, endpoints de empleados en 403, Backend diseña por `/api/ai/execute`, QA conserva el prompt
  estricto, reinicio del servidor a mitad de una prueba y espera al terminar.
- Navegador (puerto 4180, API de Messages local): tablero con AUDITORES EXTERNOS, celular del auditor, prueba en
  vivo con contadores y espera, diseño de módulo desde el panel de Claude de Backend, y las quejas de clientes
  cayendo como notificaciones sobre el espacio de trabajo.
- `npm run bench:audit`: tres partidas completas que miden el costo de un hallazgo corregido temprano frente a uno
  ignorado, contra una referencia sin auditar. Evidencia en `docs/benchmarks/auditoria/README.md`.

## Curva de tráfico

El tráfico sube más despacio que antes, para que un equipo tenga tiempo de organizarse antes de la saturación:

| Qué | Antes | Ahora |
| --- | --- | --- |
| Demanda de clientes | `5 + 295·(t/T)^1.25` | `5 + 295·(t/T)^2.5` |
| Tráfico anómalo del motor | Desde el 12 % de la partida, `2 + 18·(t/T)` | Desde el **25 %**, `2 + 18·(t/T)^2.5` |

Con un servidor, una empresa aguanta hasta el minuto **12.8** en vez de 6.5, y el final sigue siendo igual de
exigente (60 solicitudes/s). El ruido de fondo baja de 9.2/s a 3.8/s en el minuto 10, con lo que el trabajo del
auditor se distingue en vez de perderse.

**Esto cambia la línea base económica de la partida**: los benchmarks de entregas anteriores dejan de comparar
directamente con los de ahora.

## Límites

- Un auditor es una sola sesión por jugador de la sala; no hay credencial de auditor fuera de la sala.
- Los controles pendientes que elige el servidor para un módulo redactado son deterministas y, con la semilla fija de
  la partida, un estudiante podría calcularlos por fuera para buscar el conjunto más corto. El resultado sigue siendo
  un módulo con un control pendiente que Seguridad, QA y los auditores pueden encontrar.
- El tamaño de la prueba (30 solicitudes en 30 s) se tomó de la suite Seguridad; no hay otra regla de volumen.
- La suite Seguridad de un clic solo prueba entrada inválida; los pendientes de identidad requieren un escenario con
  identidad falsificada.
- Revisar con `module.revise` un módulo redactado conserva su diseño y vuelve a sortear defectos con la regla
  general de los módulos (`defects-1`).
- El sangrado de un hallazgo depende del tráfico anómalo que el motor genera solo, que arranca al 25 % de la
  partida: un hallazgo confirmado antes de ese momento no empieza a sangrar hasta entonces.
- La prueba sostenida y el sangrado se suman. Por separado ninguno es letal de golpe, pero un equipo que ignore
  varios hallazgos a la vez puede quedar en crisis bastante antes del final.

# Consecuencias de la auditoría externa

Diseño acordado el 2026-10-22. Rama `codex/sala-pin-sorteo-equipos`, sobre el commit `5dae6a2` que ya trae el rol
Auditor externo y la prueba de control.

## 1. Intención

Hoy una prueba de control **mide** y nada más: el auditor ve contadores, la empresa casi no se entera y el daño que
produce se pierde entre el tráfico anómalo que el motor genera solo. El objetivo es que entrar al sistema de una
empresa **tenga consecuencias que se sientan**, que el equipo las note sin estar mirando un panel, y que la única
salida sea tapar el hueco.

Tres cosas que esto debe lograr:

1. Cada tipo de hueco de seguridad enseña algo distinto: el castigo depende de **qué control falta** y de **qué
   módulo quedó expuesto**.
2. La empresa se entera por donde se enteraría en la vida real: **clientes molestos**, reputación que cae y presión
   de abandono que sube.
3. El ciclo se cierra solo: el equipo investiga, Seguridad configura el control que falta y el daño para.

Lo que **no** cambia: todo sigue siendo texto y contadores del motor, nadie escribe ni ejecuta código, y ninguna
mecánica nueva se inventa si el motor ya modela algo equivalente.

## 2. Decisiones tomadas

| Decisión | Elegido |
| --- | --- |
| Palanca de la saturación | **Volumen con cupo de cola**: el tráfico del auditor nunca pasa de un tercio de la capacidad, y no se admite si la cola ya va por encima de dos tercios |
| Severidad general | **Molesta pero no letal**: la empresa nunca queda sin capacidad el tiempo suficiente para ser eliminada |
| Disparo | **El auditor decide escalar**, por una ventana acotada de 60 s con su propia espera |
| Dinero | **Multa única de Q250** al confirmarse el hallazgo, una sola vez por hallazgo abierto |
| Quién corrige | **Seguridad configura el control** y lo publica por el pipeline normal |
| Inventario en cero | **Dura la ventana**; al cerrarse, el reabastecimiento normal lo recupera |
| Qué define el castigo | **El control que falta es la llave; el módulo es lo que esa llave abre** |
| Saturación | Castigo de **Rate Limit**, no de Auth |
| Servicio golpeado | **El del módulo auditado**: Request IN → entrada, Read/Write Stock → inventario, Payment → pagos |

## 3. El hallazgo

Cuando una prueba de control termina con tráfico **no contenido**, queda un **hallazgo** registrado sobre la terna
(empresa, módulo, control).

Al confirmarse:

- Se cobra la **multa de Q250** al capital de la empresa, una sola vez por hallazgo abierto.
- Entra una alerta en `#alertas-sistema` de FlowSlack, sin el nombre del auditor.
- Seguridad y el CTO ven el hallazgo en su espacio: módulo, control que falta, accesos registrados y si sigue abierto.
- Habilita la **prueba sostenida** sobre ese hallazgo.

Se cierra cuando ese control deja de figurar como pendiente en ese módulo, es decir cuando Seguridad lo configura y el
cambio llega a producción. Al cerrarse: la carga sostenida para, el inventario se recupera y FlowSlack lo informa. Si
más adelante el control vuelve a quedar pendiente en una versión nueva, es un hallazgo nuevo y vuelve a cobrarse la multa.

## 4. La prueba sostenida

Solo sobre un hallazgo abierto. Ventana de **60 s de tiempo de juego**, con espera propia. Se corta antes si el
hallazgo se cierra, si la empresa sale de la partida o si termina la partida.

Dos topes garantizan el "no letal" **por construcción**, no por calibración:

- La tasa de admisión nunca pasa de **un tercio de la capacidad web** de esa empresa. Si el equipo escala servidores,
  le pesa proporcionalmente menos: escalar sirve de verdad.
- Si la cola del servicio objetivo ya va por encima de **dos tercios**, esa solicitud no se admite. Los clientes
  legítimos siempre tienen lugar.

El tráfico entra por el servicio del módulo auditado, usando el enrutado que el motor ya tiene
(`backendService`): entrada, inventario o pagos. Así el embudo que aparece en el mapa de tráfico delata **dónde**
está el hueco, y el equipo puede deducir el módulo.

## 5. El daño, por módulo

Todos comparten las consecuencias universales de la sección 6. Lo que cambia es qué puede hacer el auditor adentro.

| Módulo | Qué hace el auditor | Palanca del motor | ¿Existe? |
| --- | --- | --- | --- |
| **Request IN** | Sostiene ráfagas en la puerta: la cola de entrada se tapa, sube la latencia y aparecen rechazos por cola llena | Volumen por `admitTraffic` sobre el servicio `security` | Ya existe |
| **Read Stock** | Acapara: **se suspende el reabastecimiento** durante la ventana y su tráfico consume lo que queda, hasta que escasea | `restockTraffic` no corre mientras la ventana está abierta | Agregado chico |
| **Write Stock** | **Deja el inventario en cero** durante la ventana, con el reabastecimiento suspendido para que se mantenga | `inventory.stock = 0` + suspensión de reabastecimiento | Agregado chico |
| **Payment** | Las compras legítimas se completan pero **no se cobran**: el cliente se lleva el producto y la empresa no factura | El ingreso de esas compras pasa a ingreso perdido | Agregado chico |
| **Response OUT** | La respuesta sale mal: el cliente **cree que falló aunque se le cobró** | Una parte de las compras completadas registra mala experiencia del cliente | Agregado chico |

El inventario en cero y la suspensión del reabastecimiento se revierten al cerrarse la ventana; el motor vuelve a
reabastecer a su ritmo normal y las ventas se recuperan solas en unos segundos.

## 6. Consecuencias universales

Pase lo que pase y se audite el módulo que se audite, **siempre**:

- **Los clientes se quejan.** El daño hace fallar compras de clientes reales, y el motor ya convierte cada fallo en
  una queja en `soporte-clientes` y en una mala experiencia del cliente.
- **La reputación baja y la presión de abandono sube.** Ya está en el motor: el fraude observado y los fallos mueven
  ambos indicadores, y los dos se muestran en pantalla.
- **La empresa pierde dinero**: la multa de Q250, más las ventas que no ocurrieron o no se cobraron.
- **Los clientes se van.** Las malas experiencias ya disparan la migración a otras empresas.

Para los dos casos donde el cliente no falla por sí solo (Payment y Response OUT) se emite la queja explícitamente,
porque ahí el daño es de cobro y de confirmación, no de disponibilidad.

## 7. Quejas y notificación

### Textos humanos

Las quejas de hoy suenan a formulario (*"Mi solicitud venció antes de recibir una respuesta."*). Se amplía el
catálogo con variantes que suenan a persona escribiendo, incluida la señal de que **antes sí funcionaba**, que es lo
que hace sospechar al equipo:

| Situación | Ejemplos |
| --- | --- |
| No hay stock | "no pude completar mi compra y la necesitaba", "hace un rato me dejaba y ahora dice que no hay" |
| Espera o rechazo | "¿les pasa algo? llevo tres intentos", "me deja a medias y se cae" |
| Cobro (Payment) | "no me recibe el pago", "me descontaron y la compra no aparece" |
| Confirmación (Response OUT) | "me dice que falló pero ya me cobraron", "¿entonces la tengo o no la tengo?" |

Las variantes se eligen con el mismo criterio determinista que ya usa FlowSlack, así que una repetición de la partida
produce las mismas quejas.

### Estilo notificación

Un componente nuevo en el espacio de trabajo muestra las quejas nuevas de `soporte-clientes` como **notificaciones de
mensaje de texto** que caen sobre la pantalla, se apilan y se van solas a los pocos segundos. No es información
nueva: es la misma que ya está en FlowSlack, presentada para que alguien levante la cabeza. Se puede silenciar, y al
silenciarla las quejas siguen llegando al canal.

Ese es el ciclo que cierra el juego: caen quejas → el equipo pregunta qué pasa → Seguridad corre sus pruebas y
encuentra el control que falta → le pide a Claude que lo configure → el cambio llega a producción → el hallazgo se
cierra y el daño para.

## 8. Curva de tráfico

Independiente de la auditoría, pero necesario para que haya tiempo de reaccionar. Hoy la demanda despega demasiado
pronto: con un servidor, una empresa se queda sin capacidad a los 6.5 minutos.

| Qué | Hoy | Nuevo |
| --- | --- | --- |
| Demanda de clientes | `5 + 295·(t/T)^1.25` | `5 + 295·(t/T)^2.5` |
| Tráfico anómalo del motor | Arranca al 12 % y sube `2 + 18·(t/T)` | Arranca al **25 %** y sube `2 + 18·(t/T)^2.5` |
| Aviso "Tráfico anómalo detectado" | Al 12 % | Al 25 %, para que coincida |

Efecto: con un servidor se aguanta hasta el minuto **12.8** en vez de 6.5, y el final sigue siendo igual de exigente
(60 solicitudes/s). El ruido de fondo baja de 9.2/s a 3.8/s en el minuto 10, con lo que el trabajo del auditor se
distingue en vez de perderse.

Esto **cambia la línea base económica**: los benchmarks de entregas anteriores dejan de comparar directamente y hay
que anotarlo en la documentación.

## 9. Privacidad y garantías

- La empresa nunca ve quién la auditó: ni nombre, ni identificador.
- La empresa ve los accesos **de su hallazgo**, no el contador global de accesos indebidos, que sigue siendo solo del
  docente para no revelar los defectos que el motor genera por su cuenta.
- La lista de controles pendientes se sigue calculando solo con controles configurados y diseño público.
- Las órdenes del auditor se registran acotadas a la empresa objetivo, con tipo fijo y sin texto del cliente.
- **No letal**: los topes de la sección 4 impiden que la capacidad llegue a cero, que es la única vía por la que el
  motor elimina a una empresa por falta de servicio. El inventario en cero no reduce la capacidad.

## 10. Pruebas

- **Hallazgo**: se confirma solo con tráfico no contenido; la multa se cobra una vez y no se repite; se cierra al
  configurar el control y vuelve a abrirse si el control queda pendiente en una versión nueva.
- **Topes**: con una empresa de un servidor, la prueba sostenida nunca deja la capacidad en cero, la empresa sigue
  vendiendo y nunca se la elimina por falta de servicio.
- **Daño por módulo**: los cinco casos, cada uno con su efecto propio y verificando que el inventario se recupera al
  cerrarse la ventana.
- **Consecuencias universales**: en los cinco casos hay quejas de clientes, baja la reputación, sube la presión y cae
  el dinero.
- **Curva**: la demanda y el tráfico anómalo siguen los valores nuevos en los minutos de referencia.
- **Servidor real**: un auditor confirma un hallazgo, sostiene la carga, Seguridad configura el control por el
  pipeline y el daño para.
- **Determinismo y durabilidad**: todo entra por el pipeline de comandos; una partida repetida produce los mismos
  hallazgos, las mismas quejas y los mismos números.

## 11. Orden de implementación

1. Curva de tráfico (independiente y pequeño; ajustar las pruebas que dependan del volumen viejo).
2. Hallazgo, multa y cierre al configurar el control.
3. Prueba sostenida con los topes, golpeando el servicio del módulo auditado.
4. Daño por módulo, los cinco casos.
5. Quejas humanas y notificación en pantalla.
6. Documentación (doc 23) y actualización del PR.

## 12. Riesgos

- **Línea base económica**: la curva nueva invalida la comparación directa con benchmarks anteriores.
- **Calibración**: "molesta pero el negocio sigue" depende de que los topes estén bien elegidos; hay que medirlo con
  una corrida real, no asumirlo.
- **Volumen de quejas**: si caen demasiadas notificaciones a la vez, el equipo deja de leerlas. FlowSlack ya agrupa
  quejas equivalentes; la notificación debe respetar ese agrupamiento.
- **Varios auditores sobre una misma empresa**: el tope de dos pruebas simultáneas por empresa ya existe, pero con
  daños distintos conviene verificar que no se acumulen de forma desproporcionada.

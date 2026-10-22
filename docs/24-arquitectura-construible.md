# Arquitectura construible: las empresas arrancan casi vacías

Estado: **propuesta de diseño**. No hay código de esta entrega. Reemplaza el arranque actual, donde las cinco
empresas nacen con la arquitectura completa e idéntica y los estudiantes solo la retocan.

Objetivo: que cada equipo **construya su sistema**. Al abrir la partida solo existe la entrada y un camino hacia la
tienda web; el equipo coloca la salida, el inventario, el checkout, los pagos, los servidores de aplicación y el
perímetro de seguridad. Cada pieza explica para qué sirve en el momento en que se arrastra, para que colocarla
enseñe algo.

## 1. El hallazgo: el juego ya tiene dos capas

Lo que hoy se llama "la arquitectura" son en realidad dos modelos distintos, y la confusión de este rediseño venía
de mezclarlos.

| Capa | Quién la define hoy | Qué decide |
| --- | --- | --- |
| **Servicios** — entrada, seguridad, tienda web, checkout, inventario, pagos, salida | **Nadie**: está cableada en el motor (`SERVICE_IDS`, `server/traffic.ts`) | Por dónde pasa cada solicitud, con qué capacidad y qué cola |
| **Bloques** — entry, read, write, payment, exit, más Lock, Retry, Cache, Idempotency… | Backend, en el editor visual | La semántica interna de la operación de compra: sobreventa, duplicados, carreras |

Las piezas que los estudiantes deben colocar — entrada, tienda web, inventario, pagos, salida, servidores de
aplicación, checkout, seguridad — **son la capa de servicios, nombre por nombre**. No hay que inventar conceptos: hay
que dejar de cablear esa capa y hacer que el motor recorra un **plano** que los equipos dibujan.

Dos hechos del motor que esta propuesta aprovecha tal como están:

- El tráfico llega **70% navegación y 30% compra** (`server/traffic.ts`), y el ingreso de Q45 por unidad solo lo
  genera la compra (`server/requests.ts`). Una empresa con *entrada → tienda web → salida* ya atiende el 70% de su
  tráfico y gana cero. El primer momento pedagógico — "tenés visitas y no vendés" — sale gratis.
- El motor ya sabe dejar un servicio sin capacidad: `stoppedServices` pone su tasa en cero dentro de `serviceRates`.
  "Servicio que todavía no existe" y "servicio detenido" son el mismo cálculo.

## 2. Decisión: el plano de servicios

Cada empresa gana un cuarto grafo, el **plano**, junto a los de backend, seguridad y producto que ya existen. El
motor deriva el recorrido de cada solicitud de ese plano en vez de la cadena fija. El grafo de bloques sobrevive
intacto: pasa a ser "lo que ocurre adentro de inventario y pagos".

### Tablero de posiciones fijas, caminos dibujados

El plano **no es un lienzo libre**. El proyector ya dibuja la topología sobre un mapa de posiciones fijas
(`src/trafficGeometry.ts`: `ENTRY`, `GATE`, `WEB`, `AUTH`, `CHECK`, `STOCK`, `PAY`, `OUT`). El plano usa esas mismas
ocho posiciones como **solares**: cada pieza se arrastra a su solar, y lo que el equipo dibuja libremente son los
**caminos** entre solares.

Esta es la decisión que más conviene revisar, porque fija el carácter del editor. La razón de elegirla:

- El mapa proyectado sigue legible para toda la clase en cualquier estado de construcción. Un lienzo libre obligaría
  a reemplazar la geometría del proyector por un acomodo dinámico, y una clase de 25 personas mirando cinco planos
  desordenados pierde lo que el proyector aporta.
- Las posiciones nunca se vuelven un enredo, pero la lección que importa se conserva: **la arquitectura son las
  conexiones**, y esas las decide el equipo. Un camino mal trazado produce un resultado malo y legible.
- La validación queda trivial: un solar está ocupado o no, un camino existe o no.

Lo que se pierde: no se puede inventar una topología distinta de la que el mapa contempla. Para un simulador de aula
con una respuesta correcta que se quiere descubrir, eso es una ventaja más que una pérdida.

### Catálogo del plano

Ocho tipos de pieza, de los cuales **la entrada viene puesta y no se puede quitar**: seis para colocar, más los
servidores. Cada pieza lleva un texto didáctico visible **antes** de arrastrarla y en el inspector después.

| Pieza | Servicio del motor | Qué habilita | Texto que ve el estudiante |
| --- | --- | --- | --- |
| Entrada | — | Admisión de solicitudes | Ya está puesta: por acá entra todo el que llega a tu empresa. |
| Tienda web | `web` | Navegación | Es la vidriera. Sin esto nadie puede ver lo que vendés. |
| Salida | — | Respuesta al cliente | Sin salida el cliente nunca recibe respuesta: entra y se queda esperando. |
| Inventario | `inventory` | Consulta y reserva de stock | Lleva la cuenta de lo que hay. Sin esto nadie sabe si queda stock. |
| Checkout | `checkout` | Armado del pedido | Donde se arma la compra antes de cobrarla. |
| Pagos | `payment` | Cobro | Cobra el pedido. Sin esto podés mostrar y reservar, pero no facturar. |
| Seguridad | `security` | Perímetro | Filtra lo que entra. Sin esto cualquiera pasa como si fuera un cliente. |
| Servidor de aplicación | capacidad de `web` y `checkout` | Capacidad | Es la máquina donde corren la tienda web y el checkout. Más servidores, más gente atendida a la vez. |

La pieza de servidor refleja una verdad que ya está en el motor: hoy **solo** `web` y `checkout` escalan con
`company.servers`; `security`, `inventory` y `payment` tienen tasa fija y caen a cero si no hay servidores. El texto
de la pieza dice exactamente eso.

Fuera del catálogo a propósito: sub-planos adentro de cada servicio, reglas de compatibilidad de puertos más allá de
"una salida por pieza" (que ya existe), un servicio de seguridad por módulo, y el balanceador como pieza — sigue
siendo el interruptor de DevOps.

## 3. Quién crea la arquitectura

No un rol: **tres**, cada uno con sus piezas sobre el mismo plano. Así nadie mira a otro dibujar durante el primer
minuto, y el reparto no invierte ninguna responsabilidad de la matriz de permisos vigente.

| Rol | Sus piezas en el plano | Por qué |
| --- | --- | --- |
| **Backend** | Tienda web, checkout, inventario, pagos, salida | Ya es dueño del grafo de lógica. El plano es esa misma lógica a grano grueso: los servicios de aplicación son suyos. |
| **Seguridad** | Perímetro, más los controles por bloque que ya configura | Ya es dueño del perímetro. |
| **DevOps** | Servidores de aplicación, dentro del alcance autorizado por el CTO | Ya provisiona infraestructura; el servidor es la máquina, no el servicio. |
| **CTO** | Ninguna | No dibuja: autoriza la plata y decide el orden de construcción. |
| **QA** | Ninguna | Corre la **prueba de humo**: ¿una compra llega de punta a punta? |

La tensión de "¿tienda web es de Backend o de DevOps?" se resuelve con una distinción que vale enseñar: **la tienda
web es un servicio que se despliega y el servidor es la máquina que lo hospeda**. Eso ya es cierto en el motor.

Todos los roles ven el plano completo; cada uno solo puede mover sus piezas. Las de los demás se ven apagadas y no se
agarran. Los solares vacíos se insinúan con el motivo de su ausencia — "sin esto nadie puede pagar" — así el plano
dice qué falta sin decir qué hacer.

## 4. Qué puede atender una empresa a medio construir

El motor camina el plano y cada tipo de solicitud exige sus servicios. Si falta alguno, la solicitud termina con un
motivo **legible para el estudiante**, no con un error técnico.

| Tipo | Servicios que exige | Si falta alguno |
| --- | --- | --- |
| Navegación (70% del tráfico) | Tienda web y salida | `NO_STOREFRONT` · "La tienda no responde" |
| Consulta de stock | Lo anterior más inventario | `NO_INVENTORY` · "No se puede consultar el stock" |
| Compra (30% del tráfico) | Lo anterior más checkout y pagos | `NO_CHECKOUT` · "Todavía no se puede comprar acá" |

Son tres entradas nuevas en `TerminalReason` y `TERMINAL_LABELS`, que es donde ya viven los motivos que lee el
estudiante. Nota para quien implemente: la consulta de stock existe en el motor pero **hoy no entra en la mezcla de
llegadas regulares**, que es solo navegación y compra. El inventario, entonces, no es opcional para vender: es parte
del recorrido de la compra, y `NO_INVENTORY` aparece sobre todo por esa vía. El orden de los caminos lo decide el equipo y el motor lo respeta: un recorrido que llega a pagos sin
pasar por inventario cobra sin haber reservado stock, y eso el motor ya lo modela como sobreventa pendiente de
resolución. El plano no corrige al equipo; le muestra la consecuencia.

## 5. Fase de montaje

Mientras la empresa todavía no puede vender está **en montaje**, y el montaje tiene dos reglas.

**Los clientes no se van.** Una compra que no se puede atender por un servicio faltante registra la **venta
perdida** (`lostRevenue`, que ya existe) y publica el reclamo en `soporte-clientes`, para que el equipo lo vea. Pero
**no** mueve insatisfacción, lealtad, reputación ni migración: el motor se saltea
`recordCustomerExperience` para ese motivo. Nadie pierde clientes por no haber construido todavía algo que nunca se
le pidió construir. La presión existe igual, y es la correcta: los rivales ya están facturando Q45 por unidad
mientras vos vas en cero. No hay techo de tiempo ni castigo por demora.

**El pipeline es libre.** Publicar un cambio del plano no pasa por Seguridad → QA → CTO: Backend y DevOps publican
directo. Si construir la arquitectura inicial exigiera el ciclo completo, los primeros minutos serían un trámite. El
CTO no queda afuera: autoriza el presupuesto de montaje de una vez y manda el orden de construcción, con el capital
de Q10 000 y el costo de publicación de Q100 más las piezas, igual que hoy.

**Cuándo termina.** La primera vez que el plano queda capaz de aceptar compras — entrada, tienda web, checkout,
inventario, pagos y salida conectados en un recorrido — el montaje se cierra. Desde ese momento todo cambio pasa por
el ciclo completo y los fallos cuentan como cualquier otro fallo. **Es irreversible**: quitar piezas después no
devuelve la protección, para que nadie desarme su plano a propósito.

La regla se enuncia en una línea para la clase: *mientras no hay clientes comprando no hay nada que romper; desde la
primera venta, todo cambio pasa por el ciclo.*

## 6. El auditor externo

No audita nada nuevo. La regla es: **una empresa se vuelve auditable cuando acepta compras**, es decir, cuando cierra
su montaje.

Eso cae solo, porque una empresa que ya vende y no colocó el perímetro tiene los cinco controles pendientes en todos
sus módulos — `pendingControls` ya los devuelve así. Mientras esté en montaje, su ficha muestra "EN MONTAJE ·
todavía no acepta compras", y una prueba de control contra ella se **rechaza con ese motivo** en vez de ejecutarse
sin efecto.

Los auditores pasan los primeros minutos viendo la carrera y detectando quién empezó a vender sin seguridad. Es una
tarea más interesante que la que tienen hoy al inicio, y no exige ningún concepto nuevo.

## 7. Simplicidad: los números

- **Seis piezas para colocar** en toda la partida, más los servidores. La entrada viene puesta.
- **Cuatro piezas y una publicación** para pasar de la nada a vender: salida, inventario, checkout, pagos. Objetivo:
  menos de dos minutos desde que abre la sala.
- **Un solo paso intermedio** antes de eso: colocar la salida, con lo que la tienda ya atiende el 70% del tráfico.
- **Cero conceptos nuevos de economía**: se reusan Q100 de publicación, el costo por pieza y el gasto de operación
  por servidor.
- **Tres motivos terminales nuevos** y un estado de montaje por empresa. Nada más en el modelo de dominio.

## 8. Partidas existentes

`server/persistence.ts` ya trae una cadena de migraciones de esquema 1 a 6. Esta entrega sube a **esquema 7** y
sintetiza, para cada empresa de una partida vieja, el **plano completo** — que es exactamente la cadena que hoy está
cableada en el motor. Las partidas guardadas y el DVR reproducen igual.

De paso eso deja gratis una opción de sala: **"arrancar con la arquitectura armada"**, el plano completo desde el
tick cero, para una clase corta donde no se quiera gastar los primeros minutos en montaje.

## 9. Impacto en el código

| Archivo | Cambio |
| --- | --- |
| `shared/types.ts` | `Domain` gana `plan`; `Company.plan: Graph`; estado de montaje; tres `TerminalReason`; el plano entra en la proyección pública. |
| `server/engine.ts` | `initialGraph('plan')` devuelve solo la entrada; `validateGraph` deja de exigir el conjunto completo y valida solares y caminos; comandos de guardado y publicación del plano. |
| `server/graphs.ts` | Recorrido del plano: de plano a lista ordenada de servicios. |
| `server/traffic.ts` | La máquina de fases deja de ser fija y sigue el recorrido del plano; `serviceRates` devuelve cero para un servicio no colocado; capacidad de cola por servicio presente. |
| `server/requests.ts` | Los tres motivos nuevos y el cierre de la solicitud por servicio faltante. |
| `server/market.ts` | Saltear la experiencia del cliente cuando el motivo es un servicio faltante y la empresa está en montaje. |
| `server/auditor.ts` | Habilitar auditoría por empresa al cerrar el montaje; rechazar la prueba durante el montaje. |
| `server/persistence.ts` | Migración de esquema 6 a 7. |
| `src/GraphEditor.tsx` | Modo plano: solares fijos, caminos libres, propiedad de piezas por rol, textos didácticos, solares vacíos con su motivo. |
| `src/DevOpsConsole.tsx` | Los servidores se colocan en el plano; la consola conserva presupuesto, estrategias y despliegue. |
| `src/TrafficCanvas.tsx` | Dibujar solares vacíos y caminos ausentes; las posiciones de `trafficGeometry.ts` no cambian. |
| `tests/` | Escalera de montaje, motivos legibles, protección de clientes, cierre irreversible, migración de esquema; las fixturas existentes reciben el plano completo. |

## 10. Riesgos

1. **La máquina de fases del tráfico** (`completeOperation`) es el corazón del cambio y la parte más delicada: hoy
   encadena seguridad → web → checkout → backend a mano. Conviene cubrirla con pruebas antes de tocarla.
2. **Las fixturas de QA, el escenario de concurrencia y el auditor** asumen un grafo backend completo. La migración a
   plano completo las deja intactas, pero hay que verificarlo con las pruebas existentes, no por inspección.
3. **El DVR y los snapshots** ganan un grafo más por empresa. Medir el tamaño del snapshot antes y después.
4. **El riesgo de diseño, no de código**: que el plano y los bloques se perciban como dos cosas que hacen lo mismo.
   La mitigación es de interfaz — el editor de bloques se abre al tocar inventario o pagos *dentro* del plano, no
   como una pestaña paralela.

## 11. Entrega en dos etapas

El trabajo de motor no depende del lienzo. Conviene partirlo:

1. **Reglas del motor**: plano en el modelo, recorrido derivado, motivos legibles, fase de montaje, auditoría
   condicionada, migración de esquema. Al terminar esta etapa el juego ya es jugable con el plano colocado desde una
   consola simple, y toda la decisión de diseño está probada.
2. **El lienzo**: solares, caminos, propiedad por rol, textos didácticos y el dibujo del proyector.

Si al cerrar la etapa 1 se decide que alcanza, nada de lo hecho se descarta.

## 12. Decisiones abiertas

- **Solares fijos frente a lienzo libre** (sección 2). Es la decisión de carácter del editor; la propuesta elige
  solares fijos por el mapa del proyector.
- **Semántica del orden de los caminos**: la propuesta deja que el motor respete el orden dibujado y muestre la
  consecuencia. Si se quiere que ciertos órdenes sean imposibles de dibujar, hay que enumerar cuáles.
- **Qué muestra el plano del rival** en la arena pública: hoy la proyección expone los módulos de cada empresa. Hay
  que decidir si el plano a medio construir de un rival es información pública.

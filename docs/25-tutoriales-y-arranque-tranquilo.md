# Tutoriales obligatorios por rol y arranque tranquilo

El docente jugó los cinco roles y el inicio fue durísimo: nadie sabía qué hacer. Esta entrega cambia dos cosas:

1. **Tutoriales obligatorios**: cada jugador, antes de jugar, hace el tutorial de su rol. El tutorial le muestra
   literalmente qué tocar y cómo, no se puede saltar y le dice cuál es su trabajo.
2. **Arranque tranquilo**: los primeros 15 minutos no hay sufrimiento; entre el minuto 15 y el 18 la demanda sube
   fuerte, y desde el 18 hay presión completa.

## 1. Una excepción deliberada a "la interfaz no ayuda"

El README dice que la interfaz no incluye ayudas ni recomendaciones. El tutorial es la única excepción, pedida por el
docente y limitada al entrenamiento: corre **antes** de jugar, en una copia de práctica, con un guion escrito (no es
IA) y nunca opina sobre la partida real. Claude sigue siendo un ejecutor estricto que no aconseja; durante el
tutorial ni siquiera está disponible.

## 2. Cuándo

| Quién | Cuándo debe el tutorial |
| --- | --- |
| Jugador de la sala (PIN) sentado en una empresa | Desde que el docente forma los equipos. El celular muestra **HACER EL TUTORIAL**. |
| Jugador de la reserva (auditor externo) | Igual: hace el tutorial de auditor. |
| Credencial de rol (`.local/access.json`) | Desde la primera vez que entra a su espacio (`/workspace`) en esa generación. |
| Producto/UX | Solo si el docente habilitó el departamento. |
| Docente | Nunca. |

- El progreso queda guardado con la sala (`GameState.tutorials`, por generación y por jugador): recargar la página o
  reiniciar el servidor retoma el mismo paso.
- Si el docente mueve a un jugador a otro asiento, ese jugador hace el tutorial del rol nuevo desde el principio.
- **RESTABLECER** empieza una generación nueva y, con ella, tutoriales nuevos.

### La regla de inicio (sin bloqueos)

**EMPEZAR JUEGO** (en `/sala`) e **INICIAR PARTIDA** (en `/control`) se habilitan cuando **todos los jugadores
conectados** terminaron su tutorial. El servidor lo verifica: `room.start` responde `TUTORIALS_PENDING` con los
nombres que faltan.

- Cuenta cada asiento del sorteo (empresas y reserva) y cada credencial que ya empezó su tutorial, **solo si tiene
  una página abierta ahora** (celular en `/unirse`, espacio de trabajo, arena: cualquier conexión).
- Quien cerró la página **no frena la sala**: el proyector lo muestra como "SIN CONEXIÓN" y el docente puede empezar.
- Pero no se lo saltea: cuando vuelva, aunque la partida ya esté corriendo, primero termina el tutorial. Hasta
  entonces sus órdenes (por la interfaz, por Claude o por socket) no llegan a la empresa real: responden
  `TUTORIAL_PENDING`.

El proyector (`/sala`) muestra el progreso de cada jugador bajo su nombre ("TUTORIAL 3/9", "✓ TUTORIAL LISTO",
"SIN CONEXIÓN · 0/7") y el botón dice "FALTAN N TUTORIALES". `/control` muestra el total y la lista de quienes faltan.

## 3. Cómo se ve

Un overlay sobre los componentes reales del espacio de trabajo (`src/tutorial/TutorialOverlay.tsx`):

- El elemento del paso queda **resaltado y usable**; el resto de la pantalla se oscurece y **no recibe clics ni
  foco**. No hay botón de saltar ni de cerrar.
- Una tarjeta dice el rol y su trabajo, el paso ("PASO 3 / 9"), un título y una o dos oraciones con **qué hacer y por
  qué**. Si la tarjeta tapa algo, **⇄ MOVER** la pasa al otro lado.
- Debajo aparecen **hechos medidos por el motor de práctica** ("2 compras completadas sobre 1 unidad · 1 sobreventa")
  y, si el estudiante se equivoca, qué falta ("En Inicio de sesión falta marcar: WAF").
- En celular la tarjeta es una hoja inferior.

Tres clases de paso (`shared/tutorial.ts`):

| Clase | Se completa cuando… |
| --- | --- |
| `read` (lectura) | El estudiante toca **ENTENDIDO**. Es la única excepción a "hacer la acción real", y si el paso habla de un resultado, ENTENDIDO se habilita recién cuando el motor lo produjo. |
| `ui` | La pantalla llega al estado pedido (por ejemplo, el panel de lógica abierto o Atomic Update conectado entre Read Stock y Write Stock), verificado en `src/tutorial/checks.ts`. |
| `action` | El **servidor confirma el comando real** sobre la copia de práctica (`server/tutorial.ts`, `done`). Ni el tiempo ni ENTENDIDO lo cierran. |

Si una recarga cerró el panel donde trabaja el paso, el resaltado cae a un elemento desde donde se puede volver a
abrirlo y la tarjeta lo dice ("Primero tocá Inventario y ABRIR SU LÓGICA INTERNA").

## 4. Dónde: una copia de práctica por jugador

Cada jugador practica en **su propia copia del motor** (`createPractice`): un `GameState` en memoria, nunca
persistido, con su empresa y sus colores. Así nadie espera a otro rol y la empresa real, su economía y el
determinismo de la sala quedan intactos (hay una prueba que compara la sala real byte a byte antes y después).

- Las órdenes del estudiante pasan por el **mismo `applyCommand`** que las reales: rol, empresa, parámetros, revisiones,
  disciplina. Una orden inválida falla igual que en la partida.
- Los **compañeros guionados** son los otros roles de la misma empresa, que actúan con comandos validados: el Backend
  guionado le entrega a Seguridad el módulo "Inicio de sesión"; a QA le llega un cambio ya revisado; al CTO, un cambio
  aprobado por QA y un pedido de presupuesto de DevOps; a DevOps, un alcance autorizado y, al llegar al paso, el cambio
  autorizado por el CTO (si la autorización de 60 s vence, el CTO guionado la renueva).
- La copia corre en la fase tranquila para siempre (sin ráfagas ni tráfico anómalo de fondo) pero permite pruebas de
  control, y su reloj va 4× más rápido mientras el motor trabaja en algo que el estudiante espera (una prueba de QA, un
  despliegue, una prueba de control).
- Mientras dura el tutorial, el espacio de trabajo muestra "MODO PRÁCTICA" y el reloj "RELOJ DE PRÁCTICA". La evidencia
  de QA, los recibos de solicitudes y FlowSlack se leen de la copia.
- Si el servidor se reinicia, la copia se reconstruye en el paso guardado: el guion vuelve a aplicar la acción canónica
  de cada paso anterior (`solve`), que es la misma que usan las pruebas de servidor real.

## 5. Qué hace cada rol

| Rol | Pasos (lo que el estudiante hace de verdad) |
| --- | --- |
| **Backend** (9) | Lee su trabajo · coloca Salida, Checkout, Inventario y Pagos · dibuja Tienda web → Checkout → Inventario → Pagos → Salida · publica · mira una venta doble sobre la última unidad (el motor la produce en la copia) · abre la lógica de Inventario · pone Atomic Update entre Read Stock y Write Stock · lo envía a Seguridad · ve dónde llegan las devoluciones. Si envía el cambio sin la corrección, QA guionado se lo devuelve con el motivo. |
| **Seguridad** (7) | Lee su trabajo · coloca el perímetro · conecta Entrada → Seguridad → Tienda web y publica antes de la primera venta · abre el módulo **Inicio de sesión** que entregó Backend (su verificación de sesión se puede saltear) · activa Auth, Role Check, WAF y Bot Detection y guarda · entrega a QA · lee qué pasa con lo que no protege. |
| **QA** (8) | Lee su trabajo · abre la configuración del caso · corre 2 compras simultáneas con stock 1 (concurrency, SOLICITUDES 2, STOCK 1, SIMULTÁNEAS 2) · lee completadas, rechazadas y sobreventas · marca la corrida como evidencia · escribe su evaluación y aprueba · abre la carta formal de devolución · lee para qué sirve. |
| **CTO** (5) | Lee su trabajo · autoriza el alcance de DevOps (monto, duración, máximo de servidores, ESCALAR y BALANCEADOR) · abre el panel de decisión · autoriza el cambio con un motivo escrito · lee qué implica autorizar. |
| **DevOps** (5) | Lee su trabajo · agrega un servidor · activa el balanceador · despliega el cambio autorizado eligiendo ROLLING o RESTART REPLACE (la tarjeta explica la diferencia) · ve dónde vive el rollback. |
| **Producto/UX** (4) | Lee su trabajo · prepara una promoción del catálogo · la envía a QA · lee el resto del ciclo. |
| **Auditor externo** (6) | Lee su trabajo · elige una empresa · abre un módulo · lee sus controles pendientes · lanza una prueba de control · lee contenidas y no contenidas. |

## 6. Arranque tranquilo

Un cronograma determinista sobre la intensidad del motor, atado al tick (`shared/pacing.ts`). **No inventa fórmulas**:
multiplica las fuentes que ya existían.

| Fase | Minutos | Demanda de clientes | Tráfico anómalo | Ráfagas LAST-UNIT | Pruebas de control | Costo de un error |
| --- | --- | --- | --- | --- | --- | --- |
| Tranquila | 0–15 | Curva de siempre × 0,5 | Ninguno | Ninguna | No se pueden lanzar (`CALM_PHASE`) | × 0,25 |
| Rampa | 15–18 | Sube linealmente de × 0,5 a × 1 | De 0 a la curva completa | Empiezan en el minuto 15, cada 45 s | Sí | De × 0,25 a × 1 |
| Completa | 18 → fin | Curva de siempre | Curva de siempre | Cada 45 s | Sí | Normal |

- "Costo de un error" escala la presión, la pérdida de reputación y el reloj de eliminación por empresa sin servicio
  (90 s a pleno, unos 6 minutos en la fase tranquila).
- La clase lo escucha: al minuto 15 aparece "Termina la fase tranquila: la demanda sube durante 3 minutos" junto a los
  avisos de ráfagas y tráfico anómalo, y al 18 "Presión completa". El reloj muestra la fase y cuánto falta para la
  siguiente; la consola del auditor cuenta hacia el minuto 15.
- **Cambiar los números**: editar `CALM_START` en `shared/pacing.ts` (`calmUntil`, `rampUntil`, `calmDemand`,
  `calmPenalty`). Cada partida nueva congela una copia en su estado, así que una partida grabada siempre se reproduce
  con el cronograma con el que se jugó, y las partidas guardadas antes de este cambio siguen con el cronograma anterior
  bit a bit (todos los factores valen exactamente 1).
- `FLOW_CALM_START=0` crea las partidas nuevas con el cronograma anterior. Sirve para ensayos y benchmarks que deben
  compararse con partidas viejas; las pruebas que miden el motor a presión completa lo usan explícitamente.
- Con la partida de 20 minutos los números son los mismos: 15 tranquilos, 3 de rampa y 2 de presión completa.

## 7. Relación con los arreglos de la PR #8

La sesión "arreglos-partida" cambia el plano después de la primera venta, la separación de conectores, la evidencia de
las suites rápidas de QA, el panel de decisión del CTO y la estrategia de DevOps. Los tutoriales no dependen de que se
fusione primero:

- **QA** usa el caso manual (`qa.execute`), que deja evidencia seleccionable en las dos versiones. El paso acepta
  cualquier corrida de concurrencia sobre una unidad, así que si después se usa la suite rápida Concurrencia también vale.
- **CTO**: el paso "Abrí el panel de decisión" se completa solo si el panel ya viene abierto, como en la PR #8.
- **DevOps**: el paso de despliegue empieza con el cambio ya autorizado, que es cuando la PR #8 habilita el selector de
  estrategia, y el selector arranca en blanco en las dos versiones.
- **Backend y Seguridad** usan el plano solo durante el montaje (publicación directa); no tocan el plano después de la
  primera venta. Los conectores más separados de la PR #8 hacen más fácil dibujar Entrada → Seguridad.

## 8. Verificación

- `tests/tutorial.test.ts`: cada rol completa su tutorial haciendo cada acción real; cada rol se reconstruye en cada
  paso (como tras un reinicio) y termina; un paso de acción no se cierra con tiempo ni con ENTENDIDO; una lectura no se
  cierra antes de que el motor produzca su resultado; un cambio sin la corrección vuelve con una carta; las órdenes de
  práctica se validan como las reales; la práctica no toca la sala real; quién debe el tutorial; progreso por jugador,
  por asiento y por generación; la regla de inicio con conectados y ausentes.
- `tests/pacing.test.ts`: fases y factores; cronograma congelado y `FLOW_CALM_START=0`; antes del minuto 15 no hay
  ráfagas, tráfico anómalo ni pruebas de control y después sí; la demanda escala la curva existente y desde el 18 es
  exactamente la anterior; el reloj de eliminación corre a un cuarto.
- `tests/tutorial-server.test.ts`: servidor real con 26 jugadores por HTTP; EMPEZAR JUEGO rechazado con 26 tutoriales
  pendientes; un jugador pendiente no llega a la empresa real; los 26 terminan su tutorial por socket como un navegador;
  las empresas reales quedan intactas; el progreso sobrevive a un reinicio; la partida arranca y, a velocidad 20,
  ninguna empresa tiene ráfagas ni tráfico anómalo hasta el minuto 15 y la presión empieza al pasar el 15.
- Recorrido en el navegador de los siete tutoriales (Backend, Seguridad, QA, CTO, DevOps, Producto/UX y Auditor en
  celular), del proyector con el progreso y del reinicio a mitad de un tutorial.

## 9. Límites

- Una credencial de rol que nunca abre su espacio de trabajo no debe tutorial (es el camino del docente y de las
  pruebas). Los asientos de la sala lo deben desde el sorteo, entren o no.
- El tutorial enseña con una copia de la empresa del jugador; lo que hace ahí no se traslada a la partida real.
- El resaltado sigue al elemento real por selectores CSS: si una pantalla cambia sus clases, hay que actualizar
  `shared/tutorial.ts` (las pruebas de cada rol fallan si una acción deja de funcionar, no si cambia un selector).

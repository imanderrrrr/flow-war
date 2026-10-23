# Jugabilidad sencilla: menos pasos para el ciclo básico

Estado: **implementado**. Parte de una auditoría de las consolas jugada con los cinco roles de una empresa: el ciclo
básico costaba demasiados pasos y los textos mezclaban códigos e inglés. El docente eligió cuatro simplificaciones
de una lista de ocho; las otras cuatro (plano que se conecta solo, tamaños de presupuesto, avanzado plegado y lista
de pendientes por rol) quedan para otra tanda.

Regla común: **ninguna cambia el motor ni la economía.** Las tres primeras son atajos de interfaz sobre comandos que
el servidor ya validaba; la única ampliación de contrato es un comentario opcional en `qa.approve`. La cuarta cambia
solo textos. El juego sigue sin recomendar: cada atajo hace lo que el estudiante eligió, nunca elige por él.

## 1. Protecciones en un toque (Backend)

Antes: arreglar una sobreventa pedía abrir un segundo lienzo, agregar Atomic Update y recablear dos caminos a mano
(6 acciones, 2 de precisión). Ahora: tocar **Inventario** en el plano, tocar **PONER** en Atomic Update y **ENVIAR A
SEGURIDAD** (3 toques).

- Al seleccionar Inventario o Pagos aparece, debajo del plano, la lógica de esa pieza: cada bloque con su costo, una
  línea de qué hace y PONER / QUITAR (`src/logicBlocks.ts`, puro y probado en `tests/logic-blocks.test.ts`).
- Cada bloque cae justo antes de la operación contra la que el motor lo lee: Atomic Update y Stock Validation antes de
  Write Stock; Lock, Queue y Cache antes de Read Stock; Idempotency y Retry antes de Payment. QUITAR vuelve a unir lo
  que estaba antes y después.
- PONER y QUITAR guardan el borrador de Backend con `draft.save`; ENVIAR manda `change.submit`. Mismo costo que cobra
  el servidor (Q100 más los bloques).
- Se ofrecen **los siete bloques** a propósito. Mostrar solo "los buenos" sería recomendar; Cache, por ejemplo,
  puede provocar sobreventa, y eso también se aprende.
- El lienzo interno sigue a un toque (**CABLEAR A MANO**) para quien quiera otro orden.

## 2. QA en tres toques

Antes: dos lugares para correr pruebas, un caso manual de 15 campos, dos botones de aprobar distintos según el tipo de
cambio y una evaluación escrita obligatoria. Ahora un solo recorrido: **elegir prueba → PROBAR → APROBAR o DEVOLVER**.

- **1 · Elegí una prueba**: las seis suites con una línea de qué simulan (`SUITE_INFO`). PROBAR manda `qa.run`.
- **2 · Resultados y evidencia**: una prueba que termina queda marcada sola; si QA la desmarca, sigue desmarcada
  (`attachFinished`).
- **3 · Decidí**: el comentario para el CTO es opcional. APROBAR manda `qa.review` con las pruebas marcadas (sin
  comentario queda "Aprobado por QA sin comentario escrito."). Si el cambio solo tiene un reporte histórico —
  Concurrencia o Carga sin módulos ni controles siguen corriendo la fixtura histórica, que no se puede marcar —
  APROBAR manda `qa.approve`, que ahora acepta `risks` opcional para no perder el comentario.
- **DEVOLVER** pide dos líneas: qué falló y qué se esperaba. Asunto y descripción salen de la primera; pasos y
  observado se copian de las pruebas adjuntas (`evidenceLines`); gravedad media. La carta completa, con todos sus
  campos, queda como opción avanzada. Un cambio del plano se devuelve sin carta (`qa.reject`), como antes.
- El caso manual sigue en CONFIGURACIÓN MANUAL AVANZADA. La regla del servidor no cambia: sin una prueba terminada no
  hay aprobación.

## 3. El CTO decide en un toque

Antes: elegir la decisión en una lista, escribir un motivo obligatorio, marcar "Confirmo" y confirmar. Ahora tres
botones sobre el cambio que espera: **AUTORIZAR Q…**, **PEDIR MÁS PRUEBAS** y **RECHAZAR**, todos con `cto.decide`.

- El toque es la confirmación: el botón nombra la decisión y, al autorizar, su costo.
- El motivo es opcional. Vacío, queda registrado qué se decidió ("Autorizado por el CTO.", "El CTO pide más
  pruebas.", "Rechazado por el CTO."), nunca un porqué inventado.
- El panel muestra costo, saldo disponible, reservado y el comentario de QA con sus pruebas.
- Se quitaron los botones repetidos de aprobar y autorizar debajo del detalle del cambio: cada rol decide en un lugar.

## 4. Textos más cortos

Eventos, alertas de FlowSlack, motivos de cierre y el relato del auditor, en español llano y sin códigos. Ejemplos:

| Antes | Ahora |
| --- | --- |
| SKU LAST-UNIT · 2 compras / 1 unidad. | Dos clientes quieren la última unidad al mismo tiempo. |
| CH-003 · DEPLOY INICIADO | CH-003: DevOps empezó a desplegarlo. |
| 3 accesos indebidos · SECURITY BREACH | 3 accesos indebidos: entraron sin permiso. |
| +1 SERVER · 2 en servicio. | 1 servidor agregado: 2 en servicio. |
| [WARN] Latencia media observada: 3200 ms. | [AVISO] Las respuestas tardan 3200 ms en promedio. |
| (5 acontecimientos equivalentes registrados desde la muestra anterior). | (se repitió 5 veces) |
| Mantenimiento · 503 | En mantenimiento |

Las quejas de clientes no se tocaron: ya suenan a personas. Los nombres que el juego enseña (sobreventa, Atomic
Update, ROLLING) se conservan.

## 5. Tutoriales

Backend, QA y CTO enseñan los recorridos nuevos (`shared/tutorial.ts`, `server/tutorial.ts`,
`src/tutorial/checks.ts`). En la práctica de QA, Seguridad guionada entrega el cambio con WAF en Write Stock para que
Concurrencia corra en staging y deje una prueba marcable.

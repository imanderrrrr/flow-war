# Entrega 1 — dos compras sobre la última unidad

Implementada sobre `codex/auditoria-fidelidad-motor`, a partir de la auditoría del documento 06. La interfaz conserva componentes, estilos, calles, edificios y sprites existentes.

## Comportamiento entregado

El escenario `last-unit-1` admite dos intenciones distintas sobre el SKU `LAST-UNIT`, con una unidad. Cada solicitud guarda ID, intención, versión de ejecución, ruta congelada, estado, lectura de stock/versión, siguiente operación, deadline y resultado terminal. El orden es determinista: se ejecuta como máximo un nodo por solicitud cada 500 ms; las dos lecturas ocurren antes de cualquiera de las dos escrituras.

| Ruta / secuencia | Completadas | Rechazadas | Compromisos | Sobreventa | Stock final |
| --- | ---: | ---: | ---: | ---: | ---: |
| Insegura, concurrente | 2 | 0 | 2 | 1 | 0 |
| Insegura, secuencial | 1 | 1 | 1 | 0 | 0 |
| Atomic cantidad 1, antes de Write | 1 | 1 | 1 | 0 | 0 |
| Atomic después de Write o desconectado | 2 | 0 | 2 | 1 | 0 |
| Atomic cantidad 2, con una unidad | 0 | 2 | 0 | 0 | 1 |

La escritura insegura usa el stock leído previamente por esa solicitud. Atomic marca la operación posterior de Write: allí comprueba stock y versión actuales y compromete la cantidad configurada indivisiblemente. Si ya hubo una escritura, Atomic no la revierte. Su cantidad debe ser un entero entre 1 y 120.

La respuesta y la validez comercial son conceptos separados. En el caso inseguro hay dos respuestas completadas, pero solo una venta respaldada por inventario: Q45 de ingreso bruto, Q3 de aporte al capital y Q8 de compensación por la unidad sobrevendida; efecto neto Q−5. La venta irregular no aporta ingreso legítimo adicional. En el caso atómico hay una venta Q45/Q3 y una intención rechazada con Q45 de ingreso potencial perdido. Las pérdidas potenciales no se descuentan otra vez del capital.

El resultado terminal es único. Los efectos comerciales se concilian mediante una marca persistente `accounted`, guardada junto con los contadores. Volver a avanzar o conciliar una solicitud terminada no repite inventario, cobros, pérdidas ni compensaciones.

## QA, producción y pipeline

`server/requests.ts` contiene el ejecutor común. La suite **Concurrencia** avanza un estado propio mediante los ticks de la sala; no usa el stock, dinero, mercado o presupuesto de producción. El contexto de backend y seguridad se congela al enviar el cambio. El informe registra fixture, versión del ejecutor, hashes de ambos grafos, versión base, lecturas, compromisos, resultados y latencia observada. El fixture es determinista y no consume PRNG; su semilla declarada es 0.

Backend envía → QA ejecuta y decide → CTO autoriza/reserva → DevOps despliega. Ninguna etapa anterior a la publicación cambia el grafo de producción. Se mantienen permisos, expiración, invalidación de base y deduplicación de comandos. Los grafos de solicitudes ya admitidas son copias independientes: el despliegue cambia la versión usada por las siguientes admisiones.

En producción el escenario reemplaza la antigua ráfaga agregada 40/20. Empieza al 24% de la duración (6:00 en 25 min, 4:48 en 20 min) y se repite cada 45 s, con dos solicitudes y una reposición de una unidad **solo en su SKU**. Nunca se ejecuta `inventoryBatch` sobre esas mismas solicitudes. Una ejecución pendiente no se sobrescribe.

El tráfico ordinario todavía usa el SKU legado (`Company.stock`). El inventario del escenario es `Company.concurrency.run.inventory`. No comparten reposiciones ni efectos. Desde la primera ejecución, el edificio existente de inventario muestra explícitamente **SKU LAST-UNIT**, su stock y sus compromisos. El evento de finalización informa completadas, rechazadas, abandonadas y sobreventas reales.

El escenario solo avanza con capacidad operativa disponible. Sin presupuesto o durante Restart espera; al cumplir 16 s sin completar, finaliza como abandonado. Un rechazo de seguridad previo no escribe inventario. Las estrategias siguen utilizando la disponibilidad agregada del prototipo; esta entrega no implementa capacidad ni drain por instancia.

## Representación y privacidad

El servidor proyecta dos partículas estables vinculadas a los IDs reales. Las etapas confirmadas determinan los segmentos de las calles existentes: espera en inventario, pagos, salida o punto de rechazo. La sobreventa se representa como anomalía aunque la respuesta se haya completado. La interpolación, el foco y el muestreo no cambian resultados ni consumen aleatoriedad del motor.

Se reutilizan los informes existentes, incorporando stock final, compromisos, abandonos, fallos y motivos observados. No hay recomendaciones ni aprobación automática. Las proyecciones públicas excluyen la ruta congelada y el contexto de ejecución; los informes y grafos privados siguen limitados a su empresa.

## Persistencia y recuperación

- El esquema de partida pasa de 1 a 2. `server/persistence.ts` recupera snapshots y pausa una sala que estaba en ejecución.
- Los snapshots nuevos conservan solicitudes, cursor, lectura, versión/ruta, pagos, ledger, conciliación y próxima ejecución. Reanudar continúa lo pendiente.
- Antes de sobrescribir un snapshot v1, el servidor conserva su JSON original en la tabla SQLite `game_migrations`, fila `schema=1`.
- La migración conserva stock legado, clientes, dinero y contadores históricos. Inicializa los nuevos contadores a cero sin fabricar solicitudes para explicar discrepancias antiguas. La próxima ejecución se agenda después del tick recuperado, sin reproducir ráfagas pasadas.
- Los informes anteriores se conservan marcados como históricos. Los cambios pendientes con evidencia del motor anterior vuelven a QA y liberan su reserva de publicación; requieren nueva prueba y las etapas posteriores. Un cambio cuya base ya no coincide debe enviarse nuevamente sobre la base actual.
- Se conserva la frecuencia existente de persistencia: cada segundo real y por comando confirmado, además del cierre normal. Un cierre abrupto puede perder ticks desde el último snapshot; estado y efectos vuelven juntos a ese punto. No se ofrece un journal completo de cada tick.
- Pausar congela ejecución, deadline y trabajos. Finalizar sala o eliminar empresa da un resultado terminal a sus solicitudes pendientes y concilia una sola vez. Un compromiso ya escrito se conserva si la solicitud termina sin respuesta; no se implementa liberación transaccional ni rollback de inventario en esta entrega.

## Verificación manual por roles

Para usar datos de ensayo separados de una partida existente:

```sh
FLOW_PORT=4176 FLOW_DATA_DIR=/private/tmp/flow-war-entrega1 npm run dev
```

Abrir `http://localhost:4176`. Las credenciales de ese ensayo están en `/private/tmp/flow-war-entrega1/access.json`. Usar dispositivos, perfiles de navegador o sesiones privadas independientes para cada rol; las pestañas del mismo perfil comparten cookie.

1. **Docente:** iniciar una partida nueva de 25 min. Para llegar al escenario rápidamente, usar 20× y regresar a 1× antes de 6:00 transcurridos (19:00 restantes). Mantener la sala en ejecución durante las acciones de los participantes.
2. **Arena, empresa NOVA:** observar la primera ejecución sin cambios. Aparecen dos solicitudes del SKU LAST-UNIT. El evento final indica dos completadas y una sobreventa; el inventario muestra `STOCK 0 / COMP. 2`. Los contadores generales incluyen también tráfico ordinario: para este escenario usar el evento y el SKU identificados.
3. **Backend de NOVA:** añadir Atomic Update, configurar **1 unidad**, reemplazar la conexión Read Stock → Write Stock por Read Stock → Atomic Update → Write Stock y conservar Write → Payment → Response. Enviar a QA. La versión de producción sigue igual.
4. **QA de NOVA:** seleccionar el cambio, elegir Concurrencia y ejecutar. Observar dos solicitudes, una completada, una rechazada, cero sobreventa, stock final cero y un compromiso. Aprobar manualmente. Un informe con fallos también puede ser aprobado por decisión humana; el motor no evalúa el plan.
5. **CTO de NOVA:** autorizar el costo. Comprobar la reserva; la publicación todavía no ocurre.
6. **DevOps de NOVA:** elegir Rolling o Restart Replace y desplegar. Al terminar cambia la versión de producción. No es posible desplegar desde Backend/QA/CTO ni sin completar las etapas.
7. **Arena:** en la siguiente ejecución programada (cada 45 s), observar una completada, una rechazada y cero sobreventa. El sprite rechazado termina en inventario; el completado llega a salida. Se muestra `STOCK 0 / COMP. 1`.
8. **Recuperación:** pausar con solicitudes aún pendientes, cerrar normalmente el servidor y arrancarlo con el mismo directorio. La sala vuelve pausada; reanudar desde Docente conserva IDs, lecturas y versión, sin generar otra pareja ni repetir los efectos ya conciliados.
9. **Variantes:** enviar una nueva revisión con Atomic desconectado o después de Write, completar QA/CTO/DevOps y observar que reaparece la sobreventa. La variante secuencial y el cruce exacto de una publicación mientras hay solicitudes activas están cubiertos por pruebas deterministas; no se añadieron controles de escenario para jugadores.

## Pruebas y archivos

Ejecutar `npm test` y `npm run build`. La suite incluye:

- Intercalado de lecturas/escrituras registrado, caso secuencial, posición/conectividad/cantidad de Atomic y rechazo explícito de piezas fuera de alcance.
- Contabilidad exclusiva, ventas respaldadas, compensación y pérdida únicas, conservación de solicitudes en cada paso y ausencia de escrituras sin servicio o con rechazo de seguridad.
- Igualdad de observaciones QA/producción e independencia de estado/contexto; permisos y pipeline sin publicación anticipada.
- Rolling y Restart con versión fijada para solicitudes anteriores y nueva versión para las siguientes.
- Recuperación SQLite antes de leer, después de leer/escribir/pagar y después de conciliar; pausa y recuperación de QA; migración de v1 y rechazo de esquemas futuros.
- Servidor real reiniciado, sesiones persistentes, pipeline con credenciales separadas, reenvío de comandos y respaldo del snapshot v1.
- Geometría de partículas reales, espera/finalización en la etapa confirmada y proyección pública sin rutas privadas.

Verificación de esta entrega: 54 pruebas aprobadas y build TypeScript/Vite aprobado. También se inspeccionaron arena e informe de QA en el navegador sobre una instancia aislada, sin modificar la partida principal. Evidencia local: `artifacts/entrega1-arena.png` y `artifacts/entrega1-qa.png` (excluidas de Git).

Motor: `server/requests.ts`, `server/scenarios.ts`, `server/graphs.ts`, `server/engine.ts`. Persistencia: `server/persistence.ts`, `server/index.ts`. Contratos: `shared/types.ts`. Presentación: `src/TrafficCanvas.tsx`, `src/trafficGeometry.ts`, `src/App.tsx`. Pruebas: `tests/concurrency.test.ts`, `tests/persistence.test.ts`, `tests/scenario-server.test.ts`, `tests/traffic.test.ts` y helpers compartidos.

## Límites que siguen pendientes

El nuevo ejecutor cubre únicamente Read, Write, Atomic, Payment y Response de esta carrera. Lock, Queue, Retry, Idempotency, Cache y Validation alcanzables generan `UNSUPPORTED_BLOCK` en el escenario, visible como rechazo; no se ignoran ni se les concede protección artificial. Las demás suites y el tráfico ordinario siguen agregados y conservan sus limitaciones documentadas. La evaluación de seguridad aún usa el helper simplificado existente, con resultado congelado por solicitud.

No se implementan clientes individuales de mercado, fidelización, incidentes nuevos, rollback, nuevas estrategias, prioridad funcional de CTO ni funcionalidades de Producto. Los resultados de esta entrega no acreditan fidelidad del resto del motor ni rendimiento de una clase completa.

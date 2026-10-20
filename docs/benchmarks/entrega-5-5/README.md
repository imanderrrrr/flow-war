# Entrega 5.5 — evidencia reproducible

Los archivos `certified/final-A/B/C-*.json` y `certified/matrix-runs.json` son la matriz certificada. Los `final-*` que quedaron directamente en esta carpeta pertenecen al observador anterior y están reemplazados, no se usan para comparar CPU; el motivo consta en `observer-superseded.json`. A se ejecuta contra un archivo inmutable del commit `b52ccc67c8aeaf3d76cf52a4db60d10e120f5942`. B y C usan el mismo código optimizado, con DVR ON y OFF respectivamente. Cada ensayo tiene 27 conexiones reales sobre loopback.

`performance-matrix.mjs` ejecuta las nueve partidas secuencialmente, sin otras baterías de carga simultáneas. Los comandos pasan por sus sockets autenticados; el preload común retiene su entrega hasta el tick declarado y llama al handler original sin cambiar el estado del motor ni su velocidad. Se conservan por separado los ACK con espera programada y los ACK descontando únicamente esa espera artificial. Los 125 mensajes humanos y 125 reintentos se envían en ráfagas idénticas.

Capas medidas: JSON de proyección completa, payload de actualización, codificación Socket.IO, payload y framing WebSocket después de compresión, bytes escritos/leídos por TCP y aplicación del estado en cliente. TCP sobre loopback no es tráfico Wi-Fi físico; no incluye cabeceras IP/TCP, retransmisiones, TLS ni airtime. Los bytes incluyen las conexiones persistentes; el HTTP de login y las consultas de comprobación quedan fuera del contador TCP de esas conexiones.

CPU y RSS corresponden al proceso servidor instrumentado. La CPU incluye zlib y el pequeño coste de los contadores. La instrumentación certificada obtiene el tamaño lógico desde el encoding existente y mide Encoder.encode, sin volver a serializar el payload ni envolver JSON.stringify. Los picos se muestrean cada 20 ms. Los percentiles de event loop de varios segmentos se presentan como el máximo p99 de segmento, no como un percentil combinado inventado. Los picos de transporte usan ventanas de un segundo.

Los archivos `*smoke*`, `A-1200-1x-valid.json`, `tests-development.txt`, `tests-new-development.txt`, `test-final.txt` y `build-ui.txt` son ensayos de desarrollo, incluso cuando su nombre contiene «valid» o «final». No se usan como referencia causal ni se ocultan sus fallos. La referencia inicial de 20 minutos se ejecutó mientras se desarrollaba y su carga de acciones precede al calendario definitivo.

`dvr-determinism.json` compara todo el estado persistible con una semilla y acciones idénticas en 1.200 y 1.500 segundos. Solo se normalizan el modo y los dos relojes de captura histórica; `serializeGame` ya excluye el outbox transitorio en ambos modos. Los hashes completos permiten comprobar igualdad sin publicar partidas ni clientes reales.

`regressions.json` contiene los comandos obligatorios, tiempos y códigos de salida de la integración. La suite y build se repiten tras el último ajuste; las cifras comparativas proceden exclusivamente de la matriz congelada. Los artefactos de las baterías existentes se copian en `regression-artifacts/` sin bases SQLite, credenciales ni cookies.

`certified/comparative-summary.json` contiene las nueve comparaciones, y `certified/validation.json` vincula pruebas, fuentes e instrumentación mediante SHA-256. El código medido corresponde a `35e870719cb63710d568d414e0ebf306d9882ecd`; el commit posterior de entrega agrega este informe y las evidencias. `checksums.sha256` cubre los archivos de esta carpeta salvo el propio manifiesto. Puede comprobarse desde esta carpeta con `shasum -a 256 -c checksums.sha256`.

El resultado principal a 1× es 96,24 % menos TCP y 97,83 % menos SQLite con DVR OFF. La CPU de proceso aumenta 45,52 % frente a la referencia; la RSS máxima baja 21,32 %. Este coste y las latencias de ráfagas quedan expresamente publicados. La prueba no certifica capacidad Wi-Fi ni fluidez de 27 navegadores.

Reproducción:

```sh
npm ci
npm test
npm run build
npm run bench:traffic
npm run bench:actions
npm run bench:connections
npm run bench:chat
npm run bench:entrega5
npm run bench:dvr-modes
npm run bench:performance-matrix -- --output-root=docs/benchmarks/entrega-5-5/repetition
```

Para regenerar las tablas de la matriz publicada y comprobar que sus hashes siguen coincidiendo con los fuentes: `node scripts/performance-report.mjs`. Este generador está fijado a `certified/`; una repetición en otra carpeta conserva sus propios archivos crudos y no reemplaza el ensayo publicado.

La matriz tarda más de una hora por sus tres ensayos reales de 20 minutos a 1×. No se puede acelerar esa parte sin cambiar el escenario. Los archivos finales existentes no se sobrescriben; una repetición completa requiere otra carpeta de salida o conservar las evidencias previas con otro nombre. No se utiliza VACUUM en ninguna configuración. Las bases de ensayo son sintéticas y temporales; se conservan medidas, tablas e hashes, no los archivos de partida ni accesos.

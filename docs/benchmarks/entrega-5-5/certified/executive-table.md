Escenario principal: 20 minutos a 1×, 27 conexiones.

| Indicador | Sistema anterior | Snapshots optimizados + DVR ON | Snapshots optimizados + DVR OFF |
|---|---:|---:|---:|
| Tráfico TCP total | 20,726.66 MiB | 780.59 MiB | 779.18 MiB |
| Reducción de tráfico | 0 % | 96.23 % | 96.24 % |
| CPU (segundos de proceso) | 353.25 | 538.63 | 514.05 |
| RAM (RSS máxima, MiB) | 446.03 | 442.47 | 350.95 |
| SQLite (MiB) | 426.96 | 427.01 | 9.25 |
| ACK p95 (ms, ráfagas incluidas) | 1,594.91 | 1,798.81 | 1,574.72 |
| Event loop p99 de segmento (ms) | 83.82 | 101.91 | 91.55 |
| Mensajes humanos perdidos | 0 | 0 | 0 |
| Filtraciones empresariales detectadas | 0 | 0 | 0 |
| Diferencias económicas (hash completo) | 0 | 0 | 0 |

Las nueve partidas certificadas finalizaron con código 0, 625 entregas autorizadas por ensayo y hashes económicos idénticos por escenario. En el escenario de aula a 1×, la configuración optimizada con DVR OFF usa 96.24 % menos bytes TCP, 97.83 % menos SQLite y 45.52 % más tiempo de CPU medido que A.

DVR ON conserva replay; DVR OFF no escribe recibos, journal, inputs, checkpoints ni puntos históricos y conserva estado vivo, QA y comunicaciones. La selección OFF continúa recomendada para salas nuevas.

Resultados desfavorables de B (snapshots optimizados con DVR ON): 20 min / 20×: CPU sube 26.85 % y RSS sube 6.28 % frente a A; 25 min / 20×: CPU sube 29.62 % y RSS baja 1.75 % frente a A; 20 min / 1×: CPU sube 52.48 % y RSS baja 0.8 % frente a A. Las latencias de ráfagas y la cadencia máxima están publicadas, aunque aumenten; reducir tráfico no elimina la persistencia síncrona por comando. El dictamen es **funcionalidad y reducción de tráfico/almacenamiento verificadas en entorno local**, con validación de Wi-Fi real, FPS de equipos de estudiantes y latencia de ráfagas pendientes antes de certificar capacidad de una red de aula concreta.

En 1× el broadcast acumulado pasa de 231.04 s a 364.72 s, mientras Encoder.encode baja de 111.11 s a 59.15 s. El coste agregado de proyección, normalización, compactación y diferencias aumenta; zlib añade CPU asíncrona. Estas mediciones no separan cada subfunción, por lo que no atribuyen todo el aumento a compresión. El proceso consume de media 28.7 % de un núcleo en A y 41.24 % en C. C reduce la RSS máxima 21.32 % y usa 4.56 % menos CPU que B, pero no recupera la CPU de A a 1×. La capacidad de CPU del servidor debe evaluarse con esa limitación.

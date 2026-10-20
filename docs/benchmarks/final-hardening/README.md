# Evidencia del hardening final

Referencia: `dd88729949dabbbf8c216c265dd580eef071a5aa`. Los resultados de aula se midieron en `346265103b55b9b6117efa42ce9b4b6bccc956c7`; la batería requerida se inició en `f2895e462c60a6a0e5c4b7cde5998ccbb18e8245`, con el mismo código de producción. Consulte [el informe completo](../../15-hardening-final-entrega-5.md) para método, resultados y límites.

- `classroom-certified-*.json`: tres ensayos completos de 27 conexiones. Cada uno identifica SHA, fuentes/digest, fecha UTC, Node, SO, CPU, RAM, workers, parámetros, tiempo real/simulado y salida. `passed` corresponde a integridad; los presupuestos se informan separadamente.
- `classroom-summary.json`: percentiles, memoria, almacenamiento, permisos y comparación derivada de esos resultados.
- `classroom-runs.json`: comandos y salidas del coordinador secuencial.
- `regression-runs.json`: las siete ejecuciones exigidas, código de salida, tiempos y hashes de los JSON gzip. El hardware/RAM libre se capturó al inicio de cada segmento de la batería; cada ejecución registra su propio `startedAt`. La reanudación distingue fuentes medidas de cambios del coordinador/informes y conserva el digest de este último.
- `*.json.gz`: JSON originales de benchmarks, comprimidos sin pérdida. Se conserva SHA-256 de la representación original y comprimida.
- `economic-regression.json`: contraste con referencias inmutables; hashes forenses comparados literalmente y selección de campos documentada.
- `final-verification.json`: resultado conjunto, SHA medidos y excepciones de latencia explícitas.
- `evidence-manifest.json`: tamaños y SHA-256 de los demás archivos; excluye su propia representación.
- `reproduction-*.txt`, `*-tests.txt`: reproducciones y pruebas específicas.
- `classroom-pilot*`, `classroom-diagnostic*`, `classroom-baseline*`, `classroom-final-*`, `build-development*`, `tests-development-interrupted.txt`: historia de investigación. Incluye intentos fallidos/interrumpidos; no sustituye la serie definitiva.
- `optional-reference-provenance.json`: procedencia de una referencia local previa que el benchmark de mercado heredado incorpora opcionalmente. No se presenta como ejecución nueva ni se usa para afirmar mejoras de rendimiento.
- `actions-interrupted-*.txt` y su JSON: salida parcial conservada tras una interrupción, sin código de salida conocido. El comando de acciones se repitió completo; esta salida no cuenta como aprobado.

No se publican SQLite, archivos de acceso, códigos reales de prueba ni cookies. Los directorios temporales de los ensayos se eliminaron. Las desconexiones/reconexiones de los clientes Node son explícitas y no equivalen a una prueba de 27 navegadores humanos.

Verificación sin modificar ni regenerar resultados:

```sh
node scripts/audit-final-verify.mjs
```

Para repetir mediciones use una copia de trabajo independiente y etiquetas nuevas; los programas heredados escriben en `artifacts/` y el coordinador de regresiones escribe sus salidas en este directorio. Prepare una carpeta de evidencia vacía en esa copia. El coordinador rechaza sobrescribir logs; `--resume` conserva resultados completos del mismo SHA y guarda aparte cualquier salida parcial antes de repetir el comando. No sobrescriba la evidencia publicada para sustituirla por su nueva ejecución.

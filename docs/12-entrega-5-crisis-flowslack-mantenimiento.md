# Entrega 5 — crisis, FlowSlack y mantenimiento

## Base y cortes

Base remota y local verificada: `d4c26036b0c2663e584d7d4287f7ffbc5858cd22`, rama `codex/entrega-4a-motor-acciones-defectos`. Árbol limpio; 181/181 pruebas antes de implementar. Trabajo en `codex/entrega-5-crisis-flowslack-dvr`, sin merge ni modificaciones de `main`. Los cortes A–L separan observabilidad, reconstrucción, crisis, presentación, mensajería automática, chat, mantenimiento total/selectivo, DVR, métricas, integración y mediciones. Ver historial Git y el informe de benchmarks para las huellas ejecutadas.

No hay proveedor de IA, SDK, claves, llamadas a Anthropic, incidentes generados por modelos ni costos de API. Ruflo no se utilizó. El dominio comercial original se conserva: no se inventan órdenes de inversión.

## Autoridad y frontera compartida

Esquema de partida **6**, contrato `flow-observability-5.1`. `server/observability.ts` asigna orden total, tick y referencias a hechos confirmados. Liquidación de solicitudes, transferencias confirmadas, decisiones del despachador, terminaciones QA, publicaciones, mantenimiento y crisis alimentan esa frontera. Los mensajes automáticos son una proyección de sus hechos. La presentación no escribe capital, reputación, población ni ledger.

`request.settled` se emite dentro del guard de contabilización de tráfico y LAST-UNIT, después de conciliar reservas y experiencia. Conserva identidad, cliente, empresa, versión ejecutada, resultado, activaciones y módulos de esa ejecución. `customer.migrated` se emite tras la transferencia indivisible del mercado. `maintenance.changed`, `crisis.entered`, `crisis.exited`, `telemetry.sample`, `slack.message` y las decisiones completan la auditoría. Los datos internos de activación permanecen en el servidor durante el juego.

## Crisis arcade

`crisis-1`: entrada con reputación **<35**, salida **≥40**. A 35 desde normal no se activa. La histéresis es únicamente presentación; no cambia reputación ni elimina empresas.

`shared/crisis.ts` deriva documentos con `floor(tiempo_en_crisis / 8)`, máximo **18**. Disposición y variación dependen de episodio e índice. No usa reloj del navegador, FPS, `Math.random` ni cronómetros locales. Pausa, aceleración, cambio de foco, reconexión y DVR usan los mismos timestamps persistidos. Al recuperar reputación, la pila disminuye durante tres segundos simulados.

La arena y el espacio de trabajo muestran sirena SVG original, pila pixelada y luz ambiental roja en encabezados. El pulso dura 3.6 segundos. Colores corporativos y Canvas de clientes conservan sus pigmentos. Los papeles no reciben eventos de puntero y están fuera de las herramientas. `prefers-reduced-motion` y **REDUCIR PARPADEO** ofrecen presentación estática; pausar congela el pulso y muestra inmediatamente la pila existente. No hay sirena audible automática.

Evidencia: [arena en crisis](images/entrega-5-crisis.png). `scripts/entrega5-demo.ts` crea una sala temporal con reputación inicial explícita 31.6; tras 60 segundos de motor se observa aproximadamente 34 y siete hojas. Es una fixture visual, no una caída fabricada dentro de una partida normal. Los benchmarks ejercitan además resultados operativos y crisis de partidas completas.

## FlowSlack

Canales por empresa: `#general`, `#alertas-sistema`, `#soporte-clientes`, `#equipo-interno`. Los humanos escriben en general/interno; los otros dos son proyecciones automáticas. Identidad, rol y empresa vienen de la sesión HttpOnly existente; no del texto o un rol declarado en el payload.

Cada mensaje tiene ID, secuencia estable, empresa/canal, fuente, autor/rol, tick, tiempo real humano, referencia causal, clave de deduplicación, contenido y menciones. La ventana en memoria retiene 80 por empresa; SQLite conserva todo el historial. La interfaz combina historial paginado y snapshots privados por ID y muestra contadores de nuevos mensajes. La reconexión recupera el historial y reenviar el mismo ID/contenido devuelve el mismo recibo. Reusar el ID con otro contenido falla.

Las referencias solo aceptan cambios o versiones de artefactos de la empresa autenticada. Menciones básicas a IDs/roles de compañeros; no crean herramientas, acciones ni privilegios. El texto de coordinación no pasa por disciplina operativa. Un empleado expulsado no puede publicar. Tras finalizar, todos los canales son de lectura. Durante pausa, los humanos pueden coordinar y conservan separados tick y hora real; no nacen experiencias sintéticas.

Límites: 1,000 caracteres, cinco referencias, 12 menciones, seis mensajes por empleado/10 segundos reales y 30 por empresa/10 segundos; 12,000 IDs humanos por partida. Texto plano, caracteres de markup/control retirados, render React sin HTML ejecutable. El canal se valida en el servidor. Las consultas SQLite y cada emisión privada se filtran por empresa; manipular companyId, referencia o ID no concede acceso. El proyector y el operador en vivo no reciben conversaciones privadas en snapshots.

Reclamaciones deterministas: timeouts, rechazos/fallos, demora >3 segundos, duplicaciones observables y transferencias realizadas. Requieren un hecho respaldado por una solicitud legítima con cliente o una migración confirmada. Cancelaciones administrativas de sala/eliminación no se presentan como experiencias comerciales. Las plantillas no producen pérdidas ni cambian fidelidad.

`symptoms-1`: muestreo de telemetría cada diez segundos simulados; errores ≥20% con al menos cinco resultados, cola >40, latencia >3,000 ms o indisponibilidad observada. La agrupación por síntoma/empresa permite una muestra cada 20 segundos y cuenta hechos suprimidos. No inventa CPU, no anuncia tipos de ataque, no recomienda mitigaciones ni revela defectos ocultos. Todos los eventos originales siguen en el journal.

[Conversación privada](images/entrega-5-flowslack.png).

## Mantenimiento de emergencia

Una sola máquina de estados: **OPERATING**, **ORDERS_PAUSED**, **FULL_MAINTENANCE**. `infra.maintenance` utiliza el catálogo, validación, idempotencia y disciplina existentes; exclusivamente DevOps. Backend ejecutando esa operación sigue produciendo la infracción original; escribir una solicitud a DevOps en FlowSlack no la produce. Un comando válido de mantenimiento no es infracción.

- Total: todas las nuevas solicitudes de negocio legítimas/maliciosas reciben `REJECTED/MAINTENANCE`, equivalente a 503, antes de entrar a Seguridad o cualquier cola. Conservan identidad y liquidación una sola vez.
- Selectivo: únicamente nuevas compras y LAST-UNIT reciben `ORDERS_PAUSED`; navegación y consultas continúan con la capacidad disponible. Es el equivalente transaccional real actual; al migrar el dominio se mapeará a ejecución de órdenes, sin inventar hoy un motor financiero.
- En vuelo: cierre de admisión con drenaje. Solicitudes previas siguen terminando, fallando o venciendo bajo versiones y deadlines originales. Pagos, reservas, operaciones pendientes, inventarios y efectos confirmados no se borran.

Rechazos legítimos usan la experiencia negativa existente, presión, reputación y migración. Ingresos solo por operaciones confirmadas. Costos de infraestructura continúan. No hay una multa fija por segundo, reembolso, reparación ni restauración de reputación al reabrir. Las solicitudes previamente admitidas pueden seguir activando defectos. Las publicaciones y defectos quedan intactos.

Política de eliminación `admission-1`: el límite anterior de **90 segundos sin capacidad** se conserva, al igual que insolvencia y colapso de mercado. El cierre voluntario con infraestructura financiada admite **180 segundos continuos** antes de eliminar. Se separan capacidad física y admisión: mantenimiento no aumenta capacidad ni da inmunidad a una empresa que ya carece de ella. A los 180 segundos de cierre sostenido se pierde la empresa; no hay reapertura automática. La presión, abandono e insolvencia también pueden eliminar antes. Las pruebas comparan 10, 30, 60, 90, 120 y 181 segundos; el informe mide 60 frente a 120. Ese margen permite observar consecuencias reales y una decisión de reapertura antes de alcanzar el límite, en lugar de hacer inevitable la eliminación a los 90 segundos. Cambiar de modo deja transiciones explícitas en la auditoría.

Controles discretos de DevOps muestran el estado confirmado y tiempo desde transición persistido. Las sesiones reales, control docente, chat y herramientas operativas siguen accesibles. [Consola de mantenimiento](images/entrega-5-mantenimiento.png).

## Persistencia y compatibilidad

Snapshot, recibos terminales, comandos de transporte, inputs de replay, eventos, puntos, checkpoints y mensajes se escriben en una sola transacción SQLite. Los buffers se limpian después del COMMIT; un fallo conserva los hechos pendientes y el rollback del comando conserva también su buffer anterior. RUNNING recupera PAUSED, con checkpoint de recuperación. No avanza el reloj mientras el proceso está detenido.

Esquemas 1–5 mantienen las migraciones anteriores; se agregan crisis, modo operativo, chat vacío y comienzo de cobertura en el tick realmente recuperado. No se inventa historia anterior. Se archiva el JSON original antiguo. Reiniciar no devuelve capacidad, empleados o clientes eliminados.

Ver [DVR y exactitud](13-dvr-forense.md) e [informe de mediciones](benchmarks/entrega-5-informe.md). Los recibos detallados heredados dominan el costo de disco; los checkpoints se comprimen y no hay snapshots de 5,000 clientes por tick. No se versionan SQLite ni journals gigantes.

## Verificación manual

```sh
npm test
npm run build
npm run bench:traffic
npm run bench:actions
npm run bench:connections
npm run bench:chat
npm run bench:entrega5
```

Para una sala visual independiente:

```sh
FLOW_DATA_DIR=/private/tmp/flow-war-entrega5-demo npm exec -- tsx scripts/entrega5-demo.ts
FLOW_DATA_DIR=/private/tmp/flow-war-entrega5-demo FLOW_PORT=4189 npm run dev
```

1. Abrir `http://localhost:4189`; confirmar sirena, reputación cercana a 34, identidad amarilla y siete documentos. Recargar pausado y comparar.
2. Usar credenciales de esa carpeta. En perfiles separados, Seguridad y Backend leen/escriben en equipo-interno; VERTEX no recibe la conversación. Probar menciones, un cambio propio, pausa y reconexión.
3. Docente reanuda. DevOps activa total: el motor confirma el estado, aparecen rechazos y mensajes neutrales. Restablecer; comprobar nuevas admisiones y versiones intactas.
4. Probar suspensión selectiva y observar que las consultas siguen terminando. Revisar alertas y reclamaciones sin diagnósticos de ataques.
5. Finalizar desde Docente y abrir `/dvr`. Revisar varios tiempos, marcadores, gráficas, servidores y versiones. Reiniciar el proceso y repetir. No hay endpoint docente para editar producción desde el scrubber.

## Límites reales

La precisión es 100 ms, no se infiere causalidad por cercanía temporal y el historial antiguo solo es exacto desde su captura. La conservación durable llega hasta el último COMMIT: un cierre abrupto puede perder hasta la cadencia de persistencia del servidor (normalmente un segundo real, hasta 20 segundos simulados a 20×). Las reconstrucciones y SQLite son locales/síncronos; no se promete escalabilidad distribuida. Los límites de chat y muestreo son deliberados. El análisis de corrección definitiva queda sin determinar si falta evidencia; no genera calificaciones académicas. El build conserva la advertencia Vite de bundle >500 kB.

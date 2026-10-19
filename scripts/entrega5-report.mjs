import fs from 'node:fs';import assert from 'node:assert/strict';import crypto from 'node:crypto';import cp from 'node:child_process';
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));const old=read('docs/benchmarks/entrega-4a-regresion.json'),oldActions=read('docs/benchmarks/entrega-4a-acciones.json'),traffic=read('artifacts/traffic-benchmark-traffic-2.0-market-3.0.json'),market=read('artifacts/market-benchmark-market-3.0.json'),actions=read('artifacts/actions-benchmark-4a.json'),connections=read('artifacts/connection-benchmark.json'),chat=read('artifacts/entrega5-chat.json'),delivery=read('artifacts/entrega5-benchmark.json');
assert.equal(delivery.results.length,22);assert.equal(actions.results.length+actions.controls.length,18);assert.equal(chat.connections,27);assert.equal(chat.messages,125);
const hash=crypto.createHash('sha256').update(delivery.sourceFiles.map(f=>f+'\n'+fs.readFileSync(f,'utf8')).join('\n')).digest('hex');assert.equal(hash,delivery.sourceDigest);
let unchanged=0;for(const[a,b]of[[old.traffic,traffic],[old.market,market]])for(const r of[...b.results,...b.controls??[]]){const p=[...a.results,...a.controls??[]].find(x=>x.duration===r.duration&&x.strategy===r.strategy&&x.migrations===r.migrations);assert.deepEqual(r.companies,p.companies);unchanged++;}for(const r of[...actions.results,...actions.controls]){const p=[...oldActions.results,...oldActions.controls].find(x=>x.duration===r.duration&&x.strategy===r.strategy&&x.control===r.control);assert.deepEqual(r.final.companies,p.final.companies);unchanged++;}
const summary=r=>({duration:r.duration,strategy:r.strategy,control:r.control,migrations:r.migrations,finalTick:r.finalTick,wallSeconds:r.wallSeconds,tickP95ms:r.tickP95ms,saveP95ms:r.saveP95ms,peak:r.peak,final:r.final?.companies??r.companies});
const results=delivery.results.map(({samples,effects,...r})=>({...r,samples:samples.filter(s=>[60,600,660,720,r.duration].includes(s.tick)).map(({crisis,companies,...s})=>({...s,crisis:structuredClone(crisis),companies:companies.map(({id,customers,capital,reputation,pressure,migratedIn,migratedOut,arrived,abandoned,rejected,servers,eliminated})=>({id,customers,capital,reputation,pressure,migratedIn,migratedOut,arrived,abandoned,rejected,servers,eliminated}))})),effects:effects.filter(e=>['infra.maintenance','module.create','deploy.start','chat.send','room.pause'].includes(e.type))}));
const report={delivery:'5',base:'d4c26036b0c2663e584d7d4287f7ffbc5858cd22',measuredCommit:delivery.commit,sourceDigest:delivery.sourceDigest,sourceFiles:delivery.sourceFiles,hardware:delivery.hardware,tests:{retained:181,added:32,passed:213},inheritedBusinessOutcomesUnchanged:unchanged,traffic:{sourceCommit:'07102a72ed584f421a09b48d1e831dae7f7ba5ac',results:traffic.results.map(summary)},market:{sourceDigest:market.sourceDigest,results:[...market.results,...market.controls].map(summary)},actions:{sourceDigest:actions.sourceDigest,results:[...actions.results,...actions.controls].map(summary)},connections,chat,results};
fs.writeFileSync('docs/benchmarks/entrega-5-resultados.json',JSON.stringify(report,null,2)+'\n');
const round=n=>Number(n).toFixed(2),max=(arr,f)=>Math.max(...arr.map(f)),min=(arr,f)=>Math.min(...arr.map(f)),rows=results.map(r=>`| ${r.name} | ${r.duration/60} | ${round(r.tick.p95)} | ${round(r.persist.p95)} | ${round(r.dbBytes/1024**2)} | ${round(max(r.seeks,s=>s.ms))} |`);
const oldConn=read('docs/benchmarks/entrega-4a-conexiones.json');const connectionOld=oldConn.current??oldConn.delivery4a??oldConn;
const metricsRows=[['Tráfico (6)',old.traffic.results,traffic.results],['Mercado y controles (18)',[...old.market.results,...old.market.controls],[...market.results,...market.controls]],['Acciones y controles (18)',[...oldActions.results,...oldActions.controls],[...actions.results,...actions.controls]]].map(([label,a,b])=>`| ${label} | ${round(max(a,r=>r.tickP95ms))} → ${round(max(b,r=>r.tickP95ms))} | ${round(max(a,r=>r.saveP95ms))} → ${round(max(b,r=>r.saveP95ms))} |`);
const commitLog=cp.execFileSync('git',['log','--reverse','--format=%h %s','d4c2603..HEAD'],{encoding:'utf8'}).trim().split('\n').map(x=>`- ${x}`).join('\n');
const e=results.filter(r=>r.name==='E-maint60'),f=results.filter(r=>r.name==='F-maint120'),g=results.filter(r=>r.name==='G-orders'),k=results.filter(r=>r.name==='K-defect-maint');
const text=`# Entrega 5 — informe final de verificación y benchmarks

Base exacta: \`d4c26036b0c2663e584d7d4287f7ffbc5858cd22\`. Rama: \`codex/entrega-5-crisis-flowslack-dvr\`. Motor y escenario final medidos: \`${delivery.commit}\`. SHA-256 del manifiesto completo de servidor/shared y escenario: \`${delivery.sourceDigest}\`. El JSON adjunto incluye los archivos. Documentación/capturas posteriores no cambian esas fuentes. Hardware: ${delivery.hardware.cpu}; Node ${delivery.hardware.node}.

213/213 pruebas: 181 anteriores conservadas y 32 nuevas. Build correcto; advertencia Vite por bundle de unos 525 kB. Se ejecutaron \`npm test\`, \`npm run build\`, \`npm run bench:traffic\`, \`npm run bench:actions\`, \`npm run bench:connections\`, \`npm run bench:chat\` y \`npm run bench:entrega5\`.

Resultados: [JSON resumido](entrega-5-resultados.json). Los JSON extensos, recibos y bases temporales quedan fuera de Git. Tráfico/mercado se midieron en el corte 07102a7 (su manifiesto coincide exactamente con ese commit); acciones coinciden con el manifiesto del corte 922bdeb; las diferencias posteriores son proyección de generación, recuperación del buffer, consultas/métricas forenses y escenario de verificación. Las partidas nuevas completas se midieron con el manifiesto final arriba. Se conservan ambas huellas, sin afirmar que un reporte antiguo ejecutó fuentes posteriores.

## Regresión respecto de 4A

Los resultados empresariales de las **42 ejecuciones heredadas** coinciden exactamente con 4A: 24 de tráfico/mercado y 18 de acciones/controles, incluidas economía, clientes, reputación, presión y disponibilidad reportada. Dos escenarios heredados H-empty finalizan antes por eliminación total; se conservan esos resultados, sin llamarlos partidas completas. Las 18 ejecuciones de acciones y las 22 nuevas sí alcanzan 1,200/1,500 segundos.

| Grupo | Mayor p95 tick, 4A → 5 (ms) | Mayor p95 guardado, 4A → 5 (ms) |
| --- | ---: | ---: |
${metricsRows.join('\n')}

La persistencia agrega hechos, inputs, chat y checkpoints; su aumento es una regresión medida. No se declara rendimiento perfecto. Las cadencias heredadas son un segundo simulado para tráfico y diez para mercado/acciones; el servidor guarda normalmente cada segundo real y al confirmar comandos. Las mediciones son locales, con variación de GC, disco y actividad del equipo. Algunos tiempos totales de reloj incluyen pausas largas del host; no se presentan como tiempo puro de CPU. No se atribuye cada diferencia a una instrucción.

## 22 partidas nuevas y replay exacto

| Escenario | Minutos | Tick p95 ms | Persistencia p95 ms | SQLite MiB | Salto máximo ms |
| --- | ---: | ---: | ---: | ---: | ---: |
${rows.join('\n')}

Se ejecutaron **${results.reduce((s,r)=>s+r.checks,0)}** comprobaciones explícitas de población y **${results.reduce((s,r)=>s+r.seeks.length,0)}** reconstrucciones exactas tras cerrar/reabrir SQLite. Los hashes comparan empresas completas (sin outbox transitorio), mercado individual, cambios, acciones y chat. Los puntos incluyen tiempos entre checkpoints, 08:30.5 y el final. No se alteró la partida original. Una prueba de proceso real termina una partida, consulta un punto, reinicia Node y vuelve a comparar exactamente ese estado histórico.

Tick p50/p95/p99 y persistencia p50/p95/p99 están desglosados por caso en el JSON. Picos medidos: heap hasta **${round(max(results,r=>r.peakHeapMiB))} MiB** (proceso/GC, no memoria exclusiva por sala); snapshot privado hasta **${max(results,r=>r.maxSnapshotBytes)} bytes**. Lectura de puntos DVR: **${round(min(results,r=>r.loadDvrMs))}–${round(max(results,r=>r.loadDvrMs))} ms**; saltos completos hasta **${round(max(results,r=>max(r.seeks,s=>s.ms)))} ms**. El endpoint visual también lee marcadores/proyecciones y añade serialización/red, por lo que leer puntos no representa toda su latencia.

Archivo SQLite completo: **${round(min(results,r=>r.dbBytes)/1024**2)}–${round(max(results,r=>r.dbBytes)/1024**2)} MiB**. Journal más checkpoints: hasta **${round(max(results,r=>r.journalBytes)/1024**2)} MiB**. El campo journalBytes mide payloads de hechos y checkpoints, no índices/páginas completas. Los recibos detallados heredados dominan el resto del almacenamiento. Se conservan por integridad y se documenta su costo. No hay snapshots de 5,000 clientes por tick.

## Evidencia de escenarios

A declara reputación inicial 34 y ninguna intervención; B declara la misma condición inicial y recupera operación mediante el pipeline normal. Se registran activación y recuperación de crisis. No se presenta esa condición de fixture como pérdida inventada durante el juego. C publica reclamaciones con causas reales y D conserva síntomas sin diagnósticos automáticos de ataques. L mantiene resultados económicos/clientes iguales entre las cinco empresas; chat y animaciones no dan ventaja.

Rechazos por mantenimiento de NOVA (20/25 min): total 60 s **${e.map(r=>r.maintenanceRejections).join(' / ')}**; total 120 s **${f.map(r=>r.maintenanceRejections).join(' / ')}**; selectivo **${g.map(r=>r.maintenanceRejections).join(' / ')}**. El cierre total comprueba cero admisiones nuevas a servicios protegidos en la ventana, sin borrar trabajo previo. Selectivo comprueba navegación terminada; el generador heredado emite browse/purchase, no query. La solicitud query explícita se prueba con el mismo motor en la suite y termina correctamente bajo suspensión selectiva.

K interviene a los 200 segundos y reabre a los 260: la tentativa anterior a los 600 encontró la empresa ya insolvente por sus pérdidas reales. El escenario no altera capital ni reglas de eliminación. K demuestra que D02 permanece publicado y se activa antes y después de reabrir: ${k.map(r=>`${r.duration/60} min: ${r.defectWindows.before} antes / ${r.defectWindows.after} después`).join('; ')}. No se repara al cerrar el gateway. H conserva transferencias reales y crecimiento de demanda del receptor. J incluye pausa/chat, recuperación y comparación temporal completa.

El primer intento integral se detuvo al exigir queries que el generador heredado nunca emite; se corrigió el escenario para contrastar tráfico de lectura generado y se repitió completo. También se congelaron las muestras con structuredClone. La admisión se comprueba estrictamente después del tick del comando: solicitudes generadas en ese mismo tick antes de recibir el cierre son trabajo previo válido. No se redujeron ni retiraron pruebas.

## Conexiones y comunicación humana

Benchmark heredado: **${connections.connections}** conexiones, confirmación p95 **${round(connections.ackP95ms)} ms**, máximo **${round(connections.ackMaxMs)} ms**, snapshot máximo **${connections.maxSnapshotBytes} bytes**. Referencia 4A publicada: p95 70.231 ms y 124,132 bytes de snapshot; la dispersión local impide prometer esa mejora en una red de aula.

FlowSlack: **${chat.humans} jugadores + Docente + proyector**, **${chat.messages}/${chat.messages}** mensajes entregados. Confirmación p50/p95/p99: **${round(chat.ack.p50)}/${round(chat.ack.p95)}/${round(chat.ack.p99)} ms**. Entrega: **${round(chat.delivery.p50)}/${round(chat.delivery.p95)}/${round(chat.delivery.p99)} ms**. Verificados aislamiento en cada snapshot/consulta, deduplicación, lectura durante pausa, reconexión, reinicio y bloqueo de escritura tras finalizar. El chat no ejecutó herramientas ni generó infracciones.

## Capturas y prueba manual

- [Sirena, reputación 34 y siete hojas](../images/entrega-5-crisis.jpg)
- [FlowSlack privado](../images/entrega-5-flowslack.jpg)
- [Mantenimiento confirmado y temporizador](../images/entrega-5-mantenimiento.jpg)
- [DVR al minuto uno](../images/entrega-5-dvr.jpg)
- [Gráficas, marcadores y arquitectura histórica](../images/entrega-5-dvr-arquitectura.jpg)

[Arquitectura, límites y pasos manuales](../12-entrega-5-crisis-flowslack-mantenimiento.md). [Diseño y validación del DVR](../13-dvr-forense.md). Las capturas usan la fixture local explícita, independiente de la sala existente del usuario.

Limitaciones: almacenamiento considerable, replay síncrono, compatibilidad por versión del motor, intervalos antiguos no reconstruibles y ventana de pérdida desde el último COMMIT. MTTR no confirmado queda nulo y la corrección definitiva no se inventa. No hay calificaciones académicas ni migración de negocio financiero.

No se utilizó Anthropic, Claude, SDK, claves, créditos API ni Ruflo. Main permanece en \`ded62dcba370b899b5295e4e81837a7276b0bc65\`, sin merges.

## Archivos modificados

- Contratos y presentación derivada: shared/observability.ts, shared/crisis.ts, shared/types.ts y shared/actions.ts.
- Hechos, captura y reconstrucción: server/observability.ts, history.ts, storage.ts, persistence.ts, engine.ts, traffic.ts, scenarios.ts, market.ts y discipline.ts.
- Comunicación y operaciones: server/flowslack.ts, chat.ts, maintenance.ts, action-validation.ts, index.ts; costos demostrados en requests.ts y module-execution.ts.
- Forense: server/dvr.ts, postmortem.ts; interfaz en src/Dvr.tsx, Crisis.tsx, FlowSlack.tsx, Maintenance.tsx, App.tsx y styles.css.
- Validación: diez archivos nuevos de pruebas, cinco expectativas de esquema actualizadas; scripts chat-benchmark.ts, entrega5-benchmark.ts, entrega5-demo.ts y entrega5-report.mjs. README, documentos 12/13, informe, JSON resumido y cinco capturas.

## Commits por cortes

${commitLog}
`;
fs.writeFileSync('docs/benchmarks/entrega-5-informe.md',text);console.log(JSON.stringify({unchanged,fullGames:results.length,reconstructions:results.reduce((s,r)=>s+r.seeks.length,0),sourceDigest:hash}));

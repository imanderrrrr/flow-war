# Calibración del sangrado de auditoría

Medido el 2026-10-22 con `npm run bench:audit`: tres partidas completas de 1500 s con la misma semilla,
auditando Write Stock con el control WAF pendiente.

```
Calibración del sangrado — costPerRequest Q1, reputación -0.02/solicitud, multa Q250

┌─────────┬─────────────────────────┬─────────┬───────────────┬─────────────────────┬──────────────┬───────────────┬────────────┬─────────────┬────────────────┐
│ (index) │ escenario               │ cerrado │ no contenidas │ perdido por la fuga │ multa + fuga │ capital final │ reputación │ clientes    │ fuera de juego │
├─────────┼─────────────────────────┼─────────┼───────────────┼─────────────────────┼──────────────┼───────────────┼────────────┼─────────────┼────────────────┤
│ 0       │ 'sin auditoría'         │ '—'     │ 0             │ 0                   │ 0            │ 19323         │ '92 → 17'  │ '999 → 362' │ false          │
│ 1       │ 'corregido a los 120 s' │ true    │ 128           │ 128                 │ 378          │ 19115         │ '88 → 18'  │ '995 → 351' │ false          │
│ 2       │ 'ignorado'              │ false   │ 3252          │ 3252                │ 3502         │ 15260         │ '88 → 0'   │ '995 → 264' │ false          │
└─────────┴─────────────────────────┴─────────┴───────────────┴─────────────────────┴──────────────┴───────────────┴────────────┴─────────────┴────────────────┘
```

## Lectura

| Criterio del diseño | Resultado |
| --- | --- |
| Arreglarlo en los primeros minutos cuesta poco más que la multa de Q250 | **Cumple**: Q378 en total, y la empresa termina prácticamente igual que una sin auditar (capital 19115 contra 19323, reputación 18 contra 17, clientes 351 contra 362). |
| Ignorarlo hasta el final deja a la empresa en crisis y perdiendo clientes | **Cumple**: reputación 0 contra 17, clientes 264 contra 362 (27 % menos que la referencia) y unos Q4000 menos de capital. |

La referencia «sin auditoría» importa: una empresa que no configura ningún control pierde clientes igual, por el
tráfico anómalo que el motor genera solo. Lo que mide esta tabla es el daño **adicional** que agrega un hallazgo
abierto, y por eso la comparación se hace contra esa referencia y no contra la empresa inicial.

## Valores

`shared/auditor.ts`, `AUDIT_LEAK`: multa Q250 por hallazgo, Q1 por solicitud no contenida y −0,02 de reputación por
solicitud. Al principio de la partida eso es alrededor de Q54 y un punto de reputación por minuto; al final, unos
Q360 y siete puntos por minuto, porque el daño es proporcional al tráfico y el tráfico crece.

La prueba `tests/auditor.test.ts` («calibración: corregir temprano…») fija estos dos criterios como regresión, para
que una calibración futura no los rompa en silencio.

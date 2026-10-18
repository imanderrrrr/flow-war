# FLOW WAR — motor de simulación

## 1. Principios y unidades

El motor será una función de estado, comando/tick y PRNG con semilla. No consulta el DOM, el reloj del navegador ni servicios externos para decidir un resultado. La misma versión de motor, escenario, semilla y secuencia de comandos produce el mismo estado.

Se distinguen cuatro conceptos:

| Concepto | Definición |
| --- | --- |
| Clientes de mercado | Personas simuladas asignadas a una empresa; determinan su cuota. |
| Clientes activos | Clientes únicos con al menos una solicitud en curso. |
| Solicitudes | Operaciones simuladas; un cliente puede generar varias y un ataque puede no tener cliente. |
| Sprites | Muestra visual de operaciones o migraciones reales; su cantidad no define métricas. |

No se usa un porcentaje mayor que 100% como probabilidad. `Presión de abandono` es un índice de gravedad de 0 a 300%, y puede superar 100%. La tasa interna de migración usa una función acotada.

Todos los valores de balance de este documento son **provisionales**. Su coherencia matemática se especifica aquí; su dificultad y duración deben validarse con partidas automatizadas y con participantes durante la implementación.

## 2. Estado inicial y escenario

| Parámetro | Valor inicial propuesto |
| --- | --- |
| Duración | 1,500 s por defecto; alternativa de 1,200 s antes de iniciar. |
| Población | 5,000 clientes persistentes: 1,000 por empresa. |
| Mercado | Exactamente 20% por empresa. |
| Capital | Q10,000 por empresa. |
| Reputación | 80/100. |
| Presión de abandono | 0%. |
| Infraestructura | Un servidor de aplicación y servicios mínimos idénticos. |
| Operación inicial autorizada | Reserva de Q750 para un servidor a Q0.50/s durante 25 min; Q600 si dura 20 min. |
| Representación inicial | Una solicitud legítima visible por empresa al iniciar; después se incorpora el flujo gradual. |
| Aplicación inicial | Web → checkout → lectura de stock → escritura de stock → pago; lectura y escritura no atómicas. |
| Seguridad inicial | Paso a aplicación sin bloques adicionales; admite tráfico no autorizado si no existe un control que lo rechace. |
| Inventario | SKU normal y SKU de alta demanda, con stock y reposición idénticos. |

Las solicitudes visibles iniciales se descuentan del primer lote de llegadas para no duplicarlas. Los 1,000 clientes representan propiedad de mercado, no 1,000 solicitudes simultáneas. Antes del inicio no corre el reloj ni se cobra operación.

Los datos del escenario incluyen capacidades, costos, mezcla de tráfico, reposición y eventos. Su configuración se congela al comenzar. Para la misma semilla, las empresas reciben cargas e incidentes equivalentes; la selección de empresa en pantalla no consume aleatoriedad.

El PRNG se divide en streams identificados por sala, empresa y subsistema. La demanda exógena se obtiene de semilla/tick/empresa y no del número de decisiones o solicitudes rechazadas. Una acción de un equipo no adelanta el calendario aleatorio de otro.

## 3. Reloj y orden del tick

Paso fijo de 100 ms, equivalente a 10 ticks/s. Un proceso secuencial por sala realiza:

1. Aplicar comandos aceptados antes del tick en su orden persistido.
2. Completar trabajos QA, transiciones de despliegue y vencimientos.
3. Generar demanda, ataques y reposición de inventario del escenario.
4. Incorporar solicitudes a sus servicios o registrar rechazo por cola llena.
5. Consumir capacidad acumulada, avanzar nodos y procesar efectos de inventario/pagos.
6. Expirar deadlines y locks; registrar resultados de solicitudes.
7. Actualizar ventanas de métricas, presión, reputación y costos.
8. Cada segundo, proponer y ejecutar migraciones con una asignación simultánea.
9. Comprobar eliminación, redistribuir clientes y evaluar fin de partida.
10. Persistir tick/eventos; cada 200 ms emitir proyecciones y cada 5 s guardar snapshot.

La capacidad fraccional se acumula entre ticks; un servicio de 3 solicitudes/s no se convierte accidentalmente en cero por redondear cada 100 ms. Las listas se recorren con orden estable por ID.

El reloj usa tiempo monotónico del host para programar pasos. Si se acumulan más de 2 s de retraso, la sala se pausa con un evento operativo visible al docente. No se descartan ticks para fingir continuidad. Pausar congela demanda, costos, autorizaciones, QA y despliegues.

## 4. Generación de tráfico y capacidad

Para duración `T` y tiempo transcurrido `t`, se propone esta demanda legítima total:

```text
D(t) = 5 + 295 × (t / T)^1.25       solicitudes/s, 0 ≤ t ≤ T
lambda_i(t) = D(t) × clientes_i / 5000
```

La carga se distribuye según los clientes actuales. Una empresa que gana mercado recibe más solicitudes y puede saturarse. Los ataques se agregan aparte; no cuentan como clientes ni aumentan mercado.

La mezcla inicial será 70% navegación y 30% intención de compra. Las llegadas usan acumuladores y una distribución determinista de clientes. Cada intención de compra tiene una clave estable para identificar reintentos, ingresos y pérdidas una sola vez.

Recorrido público: entrada → controles de seguridad aplicables → web → autenticación cuando corresponda → checkout → inventario → pagos → salida. Una navegación termina después de web; una compra atraviesa la cadena correspondiente. La autenticación operativa está representada por el bloque `Auth`; las credenciales legítimas existen en las solicitudes aunque ese bloque no esté instalado.

Capacidades base propuestas:

| Servicio | Capacidad | Cola máxima | Tiempo límite |
| --- | --- | --- | --- |
| Entrada y piezas de seguridad | 120 solicitudes/s compartidas | 240 | 3 s |
| Web | 12 solicitudes/s por servidor | 60 por servidor | 3 s |
| Checkout | 5 solicitudes/s por servidor | 30 por servidor | 3 s |
| Inventario compartido | 8 operaciones/s | 40 | 3 s |
| Pagos compartido | 10 operaciones/s | 40 | 3 s |

Cada nodo tiene latencia mínima y consume presupuesto del servicio al que pertenece. Escalar aplicación aumenta web y checkout; no multiplica automáticamente inventario ni pagos. Un balanceador distribuye carga según su política; sin él, el tráfico entra al servidor principal y las réplicas pueden quedar ociosas.

La utilización de un servicio es demanda ofrecida/capacidad efectiva, y puede superar 100%. Capacidad efectiva cero con demanda se representa como `SIN CAPACIDAD`; el cálculo interno de saturación usa un límite finito. La cola y los deadlines determinan rechazos y timeouts, sin convertir una animación en un resultado.

Al alcanzar los límites de objetos en memoria se agregan cohortes homogéneas con los mismos atributos relevantes, no se descartan operaciones sin contabilizarlas. El MVP debe limitar demanda y reintentos de forma que una sala no exceda 10,000 solicitudes en curso; si el escenario configurado viola ese límite se rechaza antes del inicio.

## 5. Grafos ejecutables y bloques

Los dos editores producen grafos dirigidos acíclicos con entrada y salida fijas. El MVP admite una cadena principal y puertos de resultado terminal `REJECT`/`ERROR`; no admite bifurcaciones arbitrarias ni ciclos. `Retry` y `Queue` encapsulan su comportamiento sin crear ciclos dibujados.

Las validaciones estructurales comprueban referencias, puertos, parámetros acotados, máximo de 20 piezas por grafo y una ruta ejecutable de entrada a salida. Los nodos desconectados pueden conservarse en el borrador y el artefacto, pero no tienen efecto en ejecución. No se rechaza una ruta por carecer de una pieza que podría mejorarla.

Se compila la ruta siguiendo conexiones, nunca buscando nombres de piezas presentes en el lienzo. Al recorrer un nodo se ejecuta su operación sobre el contexto de la solicitud. El orden puede alterar resultados. Una configuración válida puede empeorar latencia, rechazos o costos.

### Backend

Los módulos fijos incluyen `Read Stock`, `Write Stock` y `Payment`; el autor puede insertar piezas entre sus puertos de solicitud. Las piezas con alcance generan una operación o un wrapper sobre el tramo posterior, con límites explícitos. No se permite editar el catálogo desde el navegador.

| Pieza | Semántica del motor | Parámetros y contrapartidas |
| --- | --- | --- |
| `Stock Validation` | Lee stock y decide si esa compra continúa. La lectura queda en el contexto; no vuelve atómica la escritura posterior. | SKU/alcance; una lectura adicional consume capacidad. |
| `Atomic Update` | Reserva stock con comparación y actualización indivisible; sustituye el comportamiento de escritura de esa solicitud cuando llega a `Write Stock`. | Cantidad y política ante conflicto; puede devolver conflicto o stock insuficiente. |
| `Lock` | Adquiere lock por SKU antes del tramo de inventario y lo libera tras escritura/error o por TTL. | Alcance y TTL acotados; serializa y puede producir espera o expiración. |
| `Retry` | Repite el tramo posterior a partir del nodo configurado ante timeout/conflicto; conserva la clave de compra. | Máximo 0–3 reintentos, backoff y códigos; consume capacidad y puede repetir efectos. |
| `Queue` | Impone una cola acotada antes del tramo posterior, con tasa de drenaje y orden FIFO. | Capacidad y drenaje; reduce ráfagas pero añade espera y puede rechazar al llenarse. |
| `Idempotency` | Consulta/registra la clave de compra y encapsula el tramo posterior. Una repetición devuelve el resultado registrado. | TTL y alcance; colocarlo después de un efecto no evita que ese efecto ya se repita. |
| `Cache` | Reutiliza una lectura del tramo de consulta para una clave de recurso hasta su TTL. | Recurso, TTL y capacidad; puede servir stock desactualizado y no sustituye una escritura atómica. |

Para que un `Atomic Update` se ejecute antes de escribir debe estar en la ruta y haberse recorrido antes de `Write Stock`. Colocarlo después no deshace una sobreventa. El intérprete registra el nodo y tiempo del efecto; no concede un beneficio global por instalarlo.

Los locks se adquieren al entrar al nodo y se liberan en salida del tramo o finalización. Si un retry permanece dentro del alcance, conserva el lock hasta su límite; si expira, el intento debe adquirirlo otra vez. Los resultados de pago tienen IDs persistentes para detectar cobros repetidos sin generar ingresos legítimos adicionales.

### Seguridad

| Pieza | Semántica del motor | Parámetros y contrapartidas |
| --- | --- | --- |
| `Auth` | Verifica credenciales de la solicitud para rutas protegidas y establece un principal validado. | Alcance y política; un alcance excesivo puede rechazar navegación legítima. |
| `Role Check` | Comprueba permiso del principal ya validado sobre ruta/operación. Sin principal se aplica su política de rechazo. | Roles permitidos y rutas; el orden respecto a Auth tiene efecto. |
| `Rate Limit` | Token bucket por IP o identidad dentro de su alcance. | Tasa y ráfaga; puede bloquear clientes legítimos que compartan origen. |
| `IP Block` | Rechaza orígenes que coinciden con la lista configurada. | Lista y vencimiento; no distingue automáticamente clientes de atacantes. |
| `WAF` | Inspecciona patrones de payload definidos por reglas del catálogo. | Reglas activas y alcance; consume capacidad y puede tener falsos positivos. |
| `Bot Detection` | Aplica desafío o bloqueo según señales de automatización de la solicitud. | Umbral y acción; desafíos añaden latencia y algunos clientes no los completan. |

Los ataques poseen atributos concretos: credencial, rol, ruta, IP, firma y comportamiento. Los controles usan esos atributos. No existe un booleano `tieneWAF → incidente resuelto`.

## 6. Incidentes obligatorios

### Seguridad: desde el 12% de la duración

A los 3 minutos en una sesión de 25 min comienzan oleadas equivalentes contra las cinco empresas. Mezcla provisional: bots de alto volumen, payloads con firma y compras con credenciales o roles inválidos. Tasa por empresa: 2 solicitudes/s al inicio de la oleada, aumentando linealmente hasta 20 al final de la partida.

Si una solicitud llega a un efecto protegido sin el principal y permiso necesarios, se registra acceso indebido. Los bots admitidos consumen la capacidad de los servicios que alcancen. Las consecuencias se calculan con accesos y saturación observados, no por un temporizador que reduzca reputación por sí mismo.

El incidente muestra `DETECTADO`, `ACTIVO` o `CONTENIDO`. Se marca contenido tras 20 s sin accesos indebidos ni saturación atribuible a la oleada, y vuelve a activo si reaparecen. Un silencio del ataque no borra las pérdidas históricas.

### Concurrencia: desde el 24% de la duración

A los 6 minutos de una sesión de 25 min comienzan compras sincronizadas de un SKU compartido. Cada 45 s se genera una ráfaga de 40 intenciones y se repone ese SKU con 20 unidades antes de la ráfaga, igual para todos. La cola puede espaciar la llegada a inventario.

La carrera se modela con lecturas y escrituras separadas: varias solicitudes pueden leer la misma versión con stock disponible antes de escribir. La escritura insegura acepta una venta basada en la lectura previa; el ledger de unidades comprometidas puede superar las unidades existentes y se contabiliza sobreventa. La escritura atómica compara versión/stock al comprometer, y los locks afectan el orden real de acceso.

Los reintentos de pagos con timeout pueden repetir cargos si el efecto no queda protegido por idempotencia. Las pruebas muestran cantidades observadas de sobreventa, conflictos, rechazos y cobros duplicados.

Tras 20 s sin nueva sobreventa ni duplicación, el incidente puede figurar contenido. La siguiente ráfaga vuelve a poner a prueba la versión desplegada. Que el incidente cambie de estado no indica qué pieza instalar.

## 7. QA como ejecución aislada

Cada suite se ejecuta contra el artefacto inmutable combinado con su versión base. Usa fixtures propios, PRNG aislado y el mismo intérprete de producción. Sus resultados quedan ligados a artefacto, base, versión de motor y semilla.

| Suite | Fixture y observaciones |
| --- | --- |
| Concurrencia | Compras simultáneas sobre stock limitado; aceptadas, conflictos, sobreventa y duplicados. |
| Regresión | Navegación y compra válidas, stock agotado y reintento conocido; respuestas y efectos. |
| Carga | Incremento de llegadas con infraestructura de staging fijada; throughput, colas, latencia y timeouts. |
| Seguridad | Solicitudes válidas e inválidas, payloads y ráfagas; accesos indebidos, bloqueos y falsos positivos. |
| Integración | Recorrido seguridad → aplicación → inventario → pago; efectos y consistencia de respuestas. |

Las corridas terminan en 3–6 s de tiempo de juego usando pasos internos acelerados de su escenario. No consumen presupuesto de producción ni mercado. No se elige una suite automáticamente ni se extrapola un porcentaje de éxito del plan. La revisión es humana, incluso cuando existen aserciones incumplidas.

## 8. Presión de abandono y reputación

Ventana móvil de 10 s. Para cada empresa se definen magnitudes normalizadas entre 0 y 1:

- `E`: proporción de operaciones legítimas fallidas, incluyendo rechazos indebidos, timeout y compras no atendidas; una intención repetida se cuenta una vez en la tasa comercial.
- `L`: `clamp((latenciaMediaMs - 500) / 2500, 0, 1)`.
- `O`: `clamp(utilizacionMaxima - 1, 0, 1)`.
- `F`: proporción de compras con acceso indebido, sobreventa o cargo duplicado respecto a compras observadas, limitada a 1.
- `U`: fracción de tiempo sin servicio en esa ventana.
- `H`: 1 cuando hay servicio, `E < 0.02`, `F = 0`, latencia menor a 500 ms y utilización menor a 90%; 0 en otro caso.

Si no hay observaciones suficientes, una tasa sin denominador usa 0; no se inventa una penalización por ausencia de tráfico. La salud requiere servicio disponible, no solo ausencia de solicitudes.

Propuesta de evolución por segundo, integrada con `dt = 0.1`:

```text
dP/dt = 0.8E + 0.4L + 0.5O + 1.2F + 0.2U - 0.35H - 0.002P
P_siguiente = clamp(P + dt × dP/dt, 0, 300)

dR/dt = 0.04H - 0.15E - 0.30F - 0.10U
R_siguiente = clamp(R + dt × dR/dt, 0, 100)
```

Las ventanas estabilizan el feedback; el índice no salta por un único evento. Las fórmulas se mantienen internas al motor. Los jugadores observan métricas, cambios y consecuencias.

Estado visual: estable si `P < 60`; en riesgo si `60 ≤ P < 140`; colapso si `P ≥ 140` o hay indisponibilidad completa sostenida por 10 s. `COLAPSO` todavía permite recuperarse; la eliminación tiene reglas separadas.

## 9. Migración conservativa y color

Cada segundo, usando el estado previo a las transferencias:

```text
h_i = 0.002 × (P_i / 100)                   tasa interna por segundo
f_i = 1 - exp(-h_i × 1s)                   fracción, siempre entre 0 y 1
salidasDeseadas_i = clientes_i × f_i + remanente_i
```

Se ejecuta la parte entera y se conserva el remanente fraccional. Las salidas ordinarias no transfieren el último cliente; la eliminación puede transferirlo. No se permite migrar al mismo cliente dos veces en 10 s.

Destinos posibles: otras empresas no eliminadas. Peso relativo `w_j = (0.05 + R_j/100) × clamp(1 - utilizacion_j, 0.05, 1)`. Es una selección interna, no una recomendación visible. Las preferencias no garantizan que una receptora pueda atender las solicitudes posteriores.

Cada receptora tiene un cupo por segundo de `max(1, floor(clientes_j × 0.01 × clamp(1 - utilizacion_j, 0.05, 1)))` nuevos clientes. Si un destino agota cupo, se prueba otro; si todos lo agotan, el cliente permanece en origen y esa salida no se acumula como una cola infinita. La congestión de las receptoras limita la absorción ordinaria.

La asignación resuelve propuestas de todas las empresas en una sola fase, con orden rotado por semilla/segundo para no favorecer IDs. Solo después actualiza propietarios, mercado y contadores. Así un cliente recién recibido no vuelve a salir en el mismo segundo.

Invariantes:

- Mientras exista una empresa activa, la suma de clientes asignados es 5,000.
- `mercado_i = 100 × clientes_i / 5000`; no se actualiza sumando popups redondeados.
- Una migración resta uno al origen y suma uno al destino en el mismo paso.
- Los porcentajes mostrados usan distribución del remanente de redondeo para sumar 100.0%.

Cada cliente conserva un vector `loyaltyMix` de cinco colores. Inicialmente es 100% del color de su empresa. Al migrar mantiene ese vector; una visita legítima completada satisfactoriamente mezcla 20% del color de su nueva empresa y 80% del vector anterior. Tras aproximadamente 11 visitas satisfactorias conserva menos de 10% de su color previo. Los errores no aceleran el cambio de color.

Si vuelve a migrar antes de completar esa transición, conserva la mezcla actual. El evento contiene origen, destino y mezcla; el navegador interpola el recorrido, sin decidir la propiedad ni el grado de fidelidad.

## 10. Economía, despliegues e infraestructura

Saldo disponible = capital − reservas activas. Autorizar mueve saldo disponible a reserva; no cobra dos veces. Ejecutar consume la reserva y capital en la misma cantidad. Vencer o cancelar libera solo lo no gastado.

Valores económicos iniciales propuestos:

| Concepto | Valor |
| --- | --- |
| Venta legítima | Q45 de ingreso bruto; Q42 de costo de mercancía; aporte neto Q3 al capital. |
| Operación de servidor | Q0.50/s simulado, cargada a un presupuesto autorizado. |
| Publicación de cambio | Base Q100 más incorporación de piezas, según catálogo versionado. |
| Instalación de pieza | Q25–Q200 según tipo; costo exacto calculado antes de autorizar. |
| Operación de pieza alcanzable | Q0–Q0.15/s según catálogo. |
| Compra perdida | Q45 de ingreso potencial por intención legítima que no se completa antes de su deadline, una sola vez por clave. |

La instalación considera todas las piezas incluidas en el artefacto; la operación solo cobra las alcanzables desde la entrada. Los cargos de operación de piezas forman parte del presupuesto solicitado junto con su cambio y requieren autorización de CTO para su duración. No pueden consumir una reserva destinada a otro cambio. El costo mostrado separa máximo de publicación y presupuesto operativo; el segundo permanece reservado después de completar el despliegue.

Una nueva publicación reemplaza el presupuesto operativo del dominio que modifica, conservando el de los otros dominios. El saldo no consumido del presupuesto anterior se libera cuando termina su uso durante el drain. La cotización del nuevo cambio incluye ese solapamiento; si una pieza se queda sin financiamiento, su servicio se detiene y no se elimina silenciosamente de la ruta.

Una compra con fraude, sobreventa o cobro duplicado no se reconoce como venta legítima adicional; genera costos de compensación definidos en el escenario. Se contabiliza la reversión del cargo indebido para evitar enriquecer a la empresa por un fallo. Ingresos brutos, costo de mercancía y aporte neto se conservan separados en el ledger.

Los costos involuntarios se descuentan del capital y pueden dejar reservas sin respaldo suficiente. Después de cada débito se reconcilian: se cancelan primero autorizaciones de despliegues aún no iniciados y luego presupuestos operativos, del más reciente al más antiguo, hasta restablecer cobertura o detener todos los recursos. Los titulares reciben eventos factuales. Si el capital queda negativo, no se autoriza nuevo gasto; el saldo representa pérdidas acumuladas, no crédito utilizable.

Las pérdidas potenciales son una métrica comercial observada, no un débito adicional del capital. Si una compra falla y luego se recupera dentro de su deadline, solo se registra la venta; no venta y pérdida a la vez.

### Estrategias

| Estrategia | Transición simulada | Condiciones |
| --- | --- | --- |
| Restart Replace | Capacidad de aplicación cero durante 3 s; luego nueva versión. | Costo operativo temporal bajo; solicitudes pueden expirar durante la interrupción. |
| Rolling | Cambia servidores uno por uno durante 6 s, con capacidad reducida y tráfico repartido por el balanceador. | Con un servidor tiene interrupción; con varios depende de la capacidad restante. |
| Blue-Green, posterior al MVP | Mantiene la base y prepara un grupo duplicado durante 8 s, cambia tráfico y retira el anterior. | Exige reserva y capacidad temporal para ambos grupos. |

Durante Rolling, cada solicitud conserva la versión con que entró al servidor; un drain tiene límite de tiempo y una solicitud no combina arbitrariamente dos versiones de backend. Los estados operativos de inventario e idempotencia son compartidos y persistentes entre versiones. Ninguna estrategia borra incidentes automáticamente.

Agregar un servidor tarda 5 s en quedar disponible y comienza a consumir costo desde su aprovisionamiento. Retirarlo drena hasta 3 s y después cancela las solicitudes restantes. Al agotarse la reserva operativa correspondiente, los recursos de ese alcance dejan de estar disponibles; no hay deuda automática ni gasto de reservas ajenas. Esto produce un evento para CTO y DevOps.

Autoscaling posterior ejecutará una política elegida por DevOps, con límites presupuestados por CTO. No decidirá ni autorizará una política por el jugador.

## 11. Eliminación y final

Una empresa se elimina si ocurre cualquiera de estas condiciones:

- Capital menor o igual a cero y sin compras legítimas completadas durante 30 s continuos.
- Menos de 1% de mercado, presión al menos 200% y servicio no saludable durante 30 s continuos.
- Indisponibilidad total sostenida por 90 s de tiempo de juego.

Los temporizadores se reinician si deja de cumplirse su condición. El colapso visual por sí solo no elimina. Antes de salir puede recuperarse mediante el flujo normal.

La eliminación cancela cambios pendientes, trabajos, reservas no gastadas y operaciones futuras; congela métricas finales de la empresa. Sus clientes pasan a empresas supervivientes según pesos, sin cupo ordinario por tratarse de cierre forzoso. Esta absorción puede saturar a las supervivientes en ticks posteriores.

Si todas se eliminan en el mismo tick o desaparece la última, la sala finaliza y los clientes pasan a un pool `SIN SERVICIO`. En ese estado excepcional las empresas tienen 0% y el pool 100%; no se inventa una empresa ganadora. Las eliminaciones de un mismo tick se resuelven juntas.

La partida también termina cuando se cumple la duración o el docente la finaliza. Una única superviviente continúa hasta el tiempo límite: aún debe atender su mercado. Ranking y desempates se detallan en las pantallas.

## 12. Catálogo de métricas

| Métrica | Cálculo y ventana |
| --- | --- |
| Mercado | Clientes asignados / 5,000; estado actual. |
| Clientes activos | Clientes únicos con solicitudes pendientes; estado actual. |
| Capital | Saldo de ledger, sin restar reservas dos veces. |
| Ingresos potenciales perdidos | Q45 por intención legítima vencida sin compra; acumulado. |
| Presión de abandono | Índice integrado P, con `%` de gravedad. |
| Latencia media | Tiempo de fin − llegada de solicitudes legítimas finalizadas, incluidos timeouts; ventana de 10 s. |
| Errores técnicos | Fallos técnicos / solicitudes legítimas terminadas; ventana de 10 s. Rechazos comerciales se muestran aparte. |
| Saturación | Utilización y cola por servicio; máximo de empresa. |
| Despliegues | Intentos, completados y fallidos separados; acumulados. |
| Reputación | Índice integrado R de 0 a 100. |
| Clientes migrados | Entrantes, salientes y saldo, además del total histórico. |
| Accesos indebidos | Operaciones protegidas ejecutadas sin autorización; acumulado y ventana. |
| Sobreventa / duplicados | Exceso de unidades comprometidas / cargos repetidos por compra. |

Cada snapshot incluye tick y ventana. Se distingue “sin observaciones” de una latencia de 0 ms.

## 13. Renderizado y rendimiento

El servidor conserva la contabilidad completa y emite una muestra estable de recorridos, contadores de cola y eventos. En arena: máximo de 500 sprites, incluidos migrantes; las colas grandes se muestran con pocos sprites y su cantidad real. Reducir sprites nunca reduce clientes, llegadas ni efectos.

El navegador interpola posición entre snapshots de 5 Hz y dibuja hasta 60 Hz. Cada sprite tiene ID estable, ruta de servicio y resultado del servidor. La transformación de color se obtiene de la mezcla autorizada. Los números flotantes agrupan eventos confirmados para no tapar el mapa.

Objetivos a medir: 27 conexiones concurrentes obligatorias, hasta 32 con Producto; respuesta de comandos menor a 250 ms en percentil 95 en LAN; ejecución del tick menor a 50 ms en percentil 95; arena de al menos 30 FPS en el equipo de proyección acordado. Son criterios de aceptación pendientes, no mediciones realizadas.

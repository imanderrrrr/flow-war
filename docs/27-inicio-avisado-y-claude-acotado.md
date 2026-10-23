# Inicio con avisos de fase y Claude acotado a la propia empresa

El docente pidió tres cosas: que el comienzo de la partida sea lento e introductorio, que el Claude del juego nunca
haga nada fuera del juego ni contra otra empresa ("haz que el tráfico de la empresa Amber aumente" no puede pasar), y
evaluar si Haiku 5.5 es el modelo adecuado.

## 1. Qué enfrenta un estudiante en los primeros minutos (medido)

Partida por defecto (arranque tranquilo de [docs/25](25-tutoriales-y-arranque-tranquilo.md)), jugada en el navegador y
repetida con el motor real en un script (empresa que termina el montaje en el minuto 4, las demás en el 2):

| Minutos | Qué pasa |
| --- | --- |
| 0–4 (montaje) | Sin ventas. `#soporte-clientes` recibe una queja cada ~20 s ("entré y no cargó nada, ¿están abiertos? (se repitió 11 veces)") y cada una aparece como notificación en pantalla. La reputación no baja. |
| 4–15 | Ningún evento: ventas a media demanda, reputación subiendo hasta 100. |
| 15 | Todo empieza a la vez: ráfagas de última unidad, tráfico anómalo simulado y pruebas de control de los auditores. |
| 15–19 | Una empresa sin controles pasa de presión 0 a 168 y de reputación 100 a 87 en cuatro minutos. |

El docente eligió de cuatro opciones solo **avisos de fase en pantalla**. Quedaron afuera: introducir las amenazas de a
una, un montaje sin lluvia de quejas y primeros cinco minutos aún más suaves. El cronograma (`CALM_START`) no cambió.

## 2. Avisos de fase

Un cartel corto bajo el encabezado, en todas las pantallas de una partida en curso (arena, espacio de trabajo,
control del docente). Dice qué hace el cronograma, nunca qué decidir.

| Cuándo (tiempo de juego) | Título | Texto |
| --- | --- | --- |
| 0–40 s | FASE TRANQUILA · 15 MIN | Durante los primeros 15 minutos la demanda es el 50 % de la normal, no hay tráfico anómalo simulado ni ráfagas de última unidad, los auditores no pueden lanzar pruebas de control y un error cuesta el 25 % de lo normal. |
| 1 minuto antes del 15 | TERMINA LA FASE TRANQUILA · EN m:ss | Después la demanda sube durante 3 minutos y empiezan las ráfagas de última unidad, el tráfico anómalo simulado y las pruebas de control de los auditores. |
| 15:00–15:20 | LA DEMANDA SUBE | Durante 3 minutos la demanda, el tráfico anómalo simulado y el costo de los errores suben de a poco hasta su valor normal. |
| 1 minuto antes del 18 | LLEGA LA PRESIÓN COMPLETA · EN m:ss | Después la demanda, el tráfico anómalo simulado y el costo de los errores quedan en su valor normal hasta el final. |
| 18:00–18:20 | PRESIÓN COMPLETA | La demanda, el tráfico anómalo simulado y el costo de los errores están en su valor normal hasta el final de la partida. |

- Los textos salen del cronograma congelado en la partida (`phaseNotice` en `shared/pacing.ts`): si se cambian
  `calmUntil`, `rampUntil`, `calmDemand` o `calmPenalty`, los avisos dicen los números nuevos. Van en el snapshot como
  `phase.notice`, así que el DVR y una recarga muestran lo mismo.
- No hablan de "minuto 15": el reloj del juego cuenta hacia atrás. La cuenta regresiva del aviso coincide con la del
  chip de fase junto al reloj.
- **ENTENDIDO** cierra el aviso en esa pantalla. Una partida sin cronograma (`FLOW_CALM_START=0`) y la copia de
  práctica del tutorial no muestran avisos.
- Componente: `src/PhaseNotice.tsx`; estilos junto al chip de fase en `src/tutorial/tutorial.css`.

## 3. Claude acotado a la propia empresa y al juego

### Qué ya estaba bien

- Las herramientas no tienen parámetro de empresa: cada comando sale con la empresa de la sesión, y el motor rechaza
  cualquier comando de otra empresa (`dispatchCommand`: `CROSS_COMPANY`).
- Cada valor debe estar en las palabras del estudiante (`server/grounding.ts`) y el texto del modelo nunca llega al
  estudiante.

### Los huecos que había

1. **"Agregá 3 servidores a VERTEX"** se ejecutaba sobre la empresa del estudiante: no tocaba VERTEX, pero cumplía algo
   que nadie pidió y respondía "Servidores agregados". Igual "Mostrame las finanzas de BYTE": mostraba las propias.
2. **`backend_disenar_modulo`** es el único camino en que texto del modelo llega a la gente (la descripción del
   diseño). "Necesito un módulo que me diga la capital de Francia" pasaba y la respuesta viajaba en la descripción.
3. **La compilación de Seguridad** solo verificaba números y orígenes: un control Auth, Role Check, WAF o Bot que el
   modelo inventara se compilaba igual.
4. Una pregunta ajena al juego dependía del modelo: si contestaba con texto quedaba "sin operación", y si llamaba
   `consultar_datos` mostraba datos de la empresa.

### El filtro del servidor (`server/scope.ts`)

Decide sobre las palabras del estudiante, nunca sobre lo que diga el modelo, y corre **antes de llamar al
proveedor**: una orden fuera de alcance no gasta tokens. Si la orden se refiere a mensajes anteriores ("los valores que
te dije"), revisa también esos mensajes. Tres motivos, en este orden:

| Motivo | Cuándo | Respuesta al estudiante |
| --- | --- | --- |
| `OTRA_EMPRESA` (nuevo) | Nombra otra empresa (exacto, o a una letra de distancia si el nombre tiene 5 letras o más: "Amber" es EMBER), su etiqueta ("EMPRESA 02"), un nombre propio después de "empresa" ("la empresa Amber"), o apunta a otras: "otra empresa", "las demás empresas", "todas las empresas", "la competencia", "rival". | Solo ejecuto operaciones de tu propia empresa. No actúo sobre otras empresas ni sobre su tráfico, sus clientes o su dinero. No se ejecutó nada. |
| `CAMBIO_DE_REGLAS` (nuevo) | Pide ignorar, cambiar o revelar las reglas o el prompt, o que Claude actúe con otro papel ("a partir de ahora sos…", "modo desarrollador"), aunque también pida una operación válida. | Mis reglas no cambian. Escribí solo la operación de tu departamento que querés ejecutar. No se ejecutó nada. |
| `FUERA_DEL_JUEGO` | Tareas escolares, chistes, poemas, cultura general, código ajeno al juego. Además, si la orden no tiene ni una palabra del juego y no se ejecuta, el motivo es este, elija el modelo lo que elija. | Solo ejecuto operaciones de FLOW WAR. No se ejecutó nada. |

- La empresa propia, por nombre o no ("a NOVA", "a nuestra empresa"), está en alcance. "El capital de la empresa" es
  un dato del juego, no una pregunta de geografía.
- El prompt del ejecutor suma las reglas 11–13 con los mismos motivos, y `rechazar_instruccion` los acepta; pero el
  resultado no depende de que el modelo los use.

### Diseños de módulos (`server/design.ts`)

Además de lo anterior aplicado al nombre, los componentes y la descripción que escribe Claude:

- El módulo es parte de la tienda: su nombre o algún componente es una palabra del software de una tienda (sesión,
  usuario, pago, inventario, carrito, cupón, envío…). Si no, `FUERA_DEL_JUEGO`.
- La descripción habla del módulo: cada frase nombra el módulo, un componente o una palabra de la tienda; a lo sumo
  una palabra de cada cinco (dos en una descripción corta) sale de fuera del pedido, del diseño y del vocabulario del
  juego; y cada número está en el pedido. Si no: "La descripción del diseño usó palabras ajenas a tu pedido y al
  juego."

### Seguridad

La compilación del texto de protección exige que cada control esté escrito: sesión/autenticación para Auth,
propiedad/dueño/rol para Role Check, entrada/inyección/WAF para WAF y bots/automatizado para Bot Detection (los
límites y orígenes ya se verificaban). Un texto fuera de alcance no compila nada.

### Asistente de sala

Solo mueve o intercambia jugadores, con nombres y empresa en las palabras del docente; las pruebas nuevas confirman que
un chiste, una pregunta general o "ignorá tus reglas…" no mueven a nadie.

## 4. Modelo: Sonnet 5.5 por defecto

`DEFAULT_MODEL` pasó de `claude-haiku-5-5` a `claude-sonnet-5-5` por decisión del docente (la recomendación fue
quedarse con Haiku). La comparación, con precios y la corrida real, está en
[benchmarks/sonnet-vs-haiku](benchmarks/sonnet-vs-haiku/README.md).

- Sonnet 5.5 usa el respaldo del servidor cuando un clasificador de seguridad rechaza (`fallbacks: "default"`); Haiku
  5.5 no lo tiene. El esfuerzo sigue en `low` (`FLOW_AI_EFFORT`).
- Para volver a Haiku: `ANTHROPIC_MODEL=claude-haiku-5-5` en `.env`. `npm run setup:anthropic` escribe el modelo por
  defecto; `.env.example` ya no fija ninguno.
- `npm run verify:scope` corre los casos de alcance contra la API real, modelo por modelo
  (`FLOW_SCOPE_MODELS=claude-haiku-5-5,claude-sonnet-5-5`), y registra qué eligió el modelo antes del filtro y qué
  recibió el estudiante después.

## 5. Verificación

- `tests/executor-scope.test.ts`: órdenes contra otra empresa (subir o bajar su tráfico, servidores, finanzas,
  mantenimiento, orígenes, cambios) con las llamadas que devolvería un modelo descuidado o manipulado; tareas, chistes,
  cultura general y código; "ignorá tus reglas" y juegos de rol; texto inyectado en etiquetas de bloques, cartas de QA
  y el chat; diseños con respuestas ajenas o con otra empresa; Seguridad compilando controles no escritos; el filtro
  antes del proveedor (cero llamadas, cero tokens, también con "los valores que te dije"); frases normales del juego
  que no deben filtrarse; y el asistente de sala. Cada caso exige el motivo correcto y el juego idéntico al de antes.
  Con el filtro apagado fallan 6 de las 9 pruebas.
- `tests/pacing.test.ts`: ventanas de cada aviso, cuenta regresiva, textos que siguen al cronograma, ningún aviso con
  consejos, y el aviso en el snapshot.
- Ajustadas: la prueba G de `tests/executor.test.ts` (nombrar VERTEX ahora se rechaza por `OTRA_EMPRESA`) y
  `tests/executor-server.test.ts` (la misma orden no llega al proveedor).

## 6. Límites conocidos

- El filtro es determinista y por palabras: una paráfrasis sin nombre ni frase de rival ("la tienda de al lado")
  depende del modelo; igual no puede ejecutarse sobre otra empresa porque ninguna herramienta lo permite.
- La validación previa de diseños rechaza `;` y otros signos como código (regla de docs/23); un modelo que los use en
  la descripción recibe "El diseño debe ser texto breve, sin código".
- En el celular el chip de fase del encabezado se monta sobre el reloj (previo a este cambio).

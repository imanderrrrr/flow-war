# Sala con PIN y sorteo de equipos

Los estudiantes entran desde el celular con el PIN que muestra el docente, eligen nombre e icono y aparecen en la
pantalla de la sala. El docente forma los equipos con un sorteo animado y después empieza la partida.

## Recorrido

| Paso | Docente (`/sala`, proyector) | Estudiante (`/unirse`, celular) |
| --- | --- | --- |
| 1 | Ve la dirección para entrar y el PIN de 6 dígitos. | Escribe el PIN. |
| 2 | Ve a cada jugador aparecer con su icono; puede quitar a alguien antes del sorteo. | Escribe su nombre, elige uno de 30 iconos y espera. Puede salir de la sala. |
| 3 | **FORMAR EQUIPOS**: se habilita con 25 jugadores (30 si Producto/UX está activo). | Ve "Sorteando equipos…". |
| 4 | Tragamonedas por empresa, en orden: los rodillos giran con los iconos de los jugadores aún sin equipo, se detienen uno por uno, aparecen los nombres con su rol y "¡USTEDES SON …!". | Cuando su empresa aparece en el proyector, ve "SOS DE NOVA · QA" y a sus compañeros. |
| 5 | Tablero con las cinco empresas, sus integrantes, los auditores externos y el progreso del tutorial de cada uno. **EMPEZAR JUEGO** se habilita cuando todos los conectados terminaron ([doc 25](25-tutoriales-y-arranque-tranquilo.md)). | **HACER EL TUTORIAL** de su rol en su espacio de trabajo; al empezar el juego, pasa a la empresa real con ese rol (o como Auditor externo). |

El panel de control (`/control`) muestra el PIN, la cantidad de jugadores y si los equipos ya se formaron, con un
enlace a la pantalla de sala. Las credenciales por rol de `.local/access.json` siguen funcionando igual.

## Reglas

- **Todo es aleatorio**: quién va a cada empresa y qué rol toma dentro de ella. El sorteo usa el generador del
  sistema operativo (`crypto.randomInt`, Fisher–Yates), nunca la semilla del motor, por lo que la economía
  determinista no cambia. Una prueba verifica con 2 000 sorteos que cada jugador cae en cada empresa y rol con la
  misma frecuencia.
- Se sortean exactamente 5 jugadores por empresa (6 con Producto/UX), uno por rol. Los que sobran quedan en
  **reserva** y son **Auditores externos** ([doc 23](23-auditor-externo-y-modulos-con-claude.md)).
- Después del sorteo la sala no acepta jugadores nuevos ni cambios, y Producto/UX queda fijo.
- **RESTABLECER** conserva el PIN y a los jugadores, borra los equipos y permite sortear de nuevo.
- Los nombres son de 1 a 20 caracteres, únicos en la sala (sin distinguir mayúsculas ni tildes). Los iconos pueden
  repetirse.
- Los iconos excluyen emojis de doble sentido (melocotón, cerezas, banano, fuego, hongo, entre otros); el servidor
  rechaza cualquier icono fuera de la lista aunque se envíe a mano.

## Ajustar equipos con Claude (solo el docente)

Después de **FORMAR EQUIPOS** y antes de **EMPEZAR JUEGO**, la pantalla de sala muestra abajo a la derecha el botón
de Claude, solo en la sesión del docente. El docente dicta la orden con el micrófono (el navegador la transcribe con
la Web Speech API; Claude nunca recibe audio) o la escribe. Ejemplos: "cambiá a Víctor de VERTEX a EMBER",
"intercambiá a Ana con Luis". Una frase dictada se envía sola al terminar.

| Orden | Resultado |
| --- | --- |
| Mover a un jugador a una empresa | Un integrante al azar de esa empresa ocupa el lugar anterior del jugador (empresa y rol). Cada empresa conserva un jugador por rol. |
| Mover a un jugador de la reserva | Entra con el rol del integrante desplazado, que pasa a la reserva. |
| Intercambiar a dos jugadores | Intercambian empresa y rol (o rol, si son de la misma empresa). |

- **Claude no opina ni cuestiona**: solo traduce la orden a `mover_jugador` o `intercambiar` (herramientas estrictas,
  Haiku 5.5). Solo pregunta cuando falta un dato o un nombre no existe o es ambiguo ("Hay 2 jugadores que coinciden con
  'Hugo': Hugo Paz, Víctor Hugo. ¿A cuál te referís?").
- **El servidor verifica y ejecuta**: cada nombre y empresa debe estar en las palabras del docente; los nombres se
  resuelven contra la sala en el servidor (sin tildes ni mayúsculas, el nombre exacto gana). Con dos empresas en la
  orden, el destino es la que va después de "a"; si el origen dicho no coincide, responde el hecho ("Víctor está en
  EMBER, no en NOVA") y no mueve a nadie. La respuesta la compone el servidor; el texto del modelo no se muestra.
- **Privacidad**: al proveedor solo viajan la orden y los nombres de las cinco empresas, no la lista de jugadores.
- **Durable y revalidado**: antes de llamar a Claude se comprueba la ventana (sin gasto si no corresponde); al volver
  se revalida que la sala y el sorteo no cambiaron y la orden completa se aplica en una sola escritura en SQLite (todo
  o nada, máximo cuatro movimientos). Los celulares obtienen su asiento del sorteo, así que pasan solos a la nueva
  empresa y rol.
- Límite de 12 órdenes por minuto; una cola propia en el planificador de Claude, separada de las cinco empresas, y
  consumo de tokens guardado con la sala y visible en el estado de Claude del docente.

## Seguridad y persistencia

- El PIN solo lo ve el docente; la vista pública de la sala muestra nombres, iconos y equipos mientras se espera.
  Durante la partida, los equipos solo los ve el docente.
- Unirse crea una sesión propia (cookie `HttpOnly`, 12 h). Esa sesión no tiene permisos hasta el sorteo; después
  actúa con la misma identidad que la credencial de su empresa y rol, y pasa por las mismas validaciones del servidor.
- Intentos limitados por dirección: 240 solicitudes por minuto y 20 PIN incorrectos por minuto.
- La sala vive en el estado de la partida: cada ingreso, salida y sorteo se escribe en SQLite antes de responder y
  sobrevive a un reinicio del servidor.
- La dirección que se muestra para entrar usa la interfaz de red física (Wi-Fi/Ethernet) y descarta túneles VPN y
  redes de máquinas virtuales.

## Verificación

- `tests/lobby.test.ts`: PIN, validaciones, 25/30 jugadores, un rol por empresa, reserva, economía intacta,
  identidad del jugador sentado, visibilidad del PIN, reinicio, RESTABLECER y uniformidad del sorteo.
- `tests/lobby-server.test.ts`: servidor real con 26 jugadores por HTTP, cada uno con su cookie; sorteo solo del
  docente, 25 identidades distintas, comandos por socket con el rol sorteado, reserva como auditor externo sin permisos de empresa, reinicio del
  servidor y RESTABLECER.
- Navegador: celular (375 px) y proyector; sorteo completo con animación, revelación en el celular y paso
  automático al espacio de trabajo al empezar.
- `tests/room-assistant.test.ts`: ventana de ajuste, intercambio de asientos, reserva, un jugador por rol, economía
  intacta, nombres y empresas presentes en la orden, nombres ambiguos o desconocidos, origen equivocado, órdenes
  negadas, consejo, contrato estricto y datos enviados al proveedor.
- `tests/room-assistant-server.test.ts`: servidor real con una API de Messages local; solo el docente, celulares que
  cambian de asiento, reserva, persistencia tras reinicio, consumo registrado y bloqueo al empezar el juego sin
  llamar al proveedor.

## Límites

- Quien llega después del sorteo no puede entrar; para incluirlo hay que RESTABLECER y sortear de nuevo.
- Con menos de 25 jugadores no se pueden formar equipos desde la sala; se pueden usar las credenciales por rol.
- La reserva juega como Auditor externo; su pantalla y reglas están en el [doc 23](23-auditor-externo-y-modulos-con-claude.md).

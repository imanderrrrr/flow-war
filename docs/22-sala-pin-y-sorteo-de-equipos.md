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
| 5 | Tablero con las cinco empresas, sus integrantes y la reserva. **EMPEZAR JUEGO**. | Pasa a su espacio de trabajo con ese rol. |

El panel de control (`/control`) muestra el PIN, la cantidad de jugadores y si los equipos ya se formaron, con un
enlace a la pantalla de sala. Las credenciales por rol de `.local/access.json` siguen funcionando igual.

## Reglas

- **Todo es aleatorio**: quién va a cada empresa y qué rol toma dentro de ella. El sorteo usa el generador del
  sistema operativo (`crypto.randomInt`, Fisher–Yates), nunca la semilla del motor, por lo que la economía
  determinista no cambia. Una prueba verifica con 2 000 sorteos que cada jugador cae en cada empresa y rol con la
  misma frecuencia.
- Se sortean exactamente 5 jugadores por empresa (6 con Producto/UX), uno por rol. Los que sobran quedan en
  **reserva**, sin rol, hasta que se defina su función (tráfico o atacantes, pendiente).
- Después del sorteo la sala no acepta jugadores nuevos ni cambios, y Producto/UX queda fijo.
- **RESTABLECER** conserva el PIN y a los jugadores, borra los equipos y permite sortear de nuevo.
- Los nombres son de 1 a 20 caracteres, únicos en la sala (sin distinguir mayúsculas ni tildes). Los iconos pueden
  repetirse.
- Los iconos excluyen emojis de doble sentido (melocotón, cerezas, banano, fuego, hongo, entre otros); el servidor
  rechaza cualquier icono fuera de la lista aunque se envíe a mano.

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
  docente, 25 identidades distintas, comandos por socket con el rol sorteado, reserva sin permisos, reinicio del
  servidor y RESTABLECER.
- Navegador: celular (375 px) y proyector; sorteo completo con animación, revelación en el celular y paso
  automático al espacio de trabajo al empezar.

## Límites

- Quien llega después del sorteo no puede entrar; para incluirlo hay que RESTABLECER y sortear de nuevo.
- Con menos de 25 jugadores no se pueden formar equipos desde la sala; se pueden usar las credenciales por rol.
- La reserva todavía no tiene rol ni pantalla de juego propia.

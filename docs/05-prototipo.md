# FLOW WAR — ejecutar el prototipo

El proyecto ya contiene una interfaz funcional y un primer motor de simulación. Los documentos 01–04 conservan el diseño objetivo; este documento distingue lo implementado de las ampliaciones previstas.

## Inicio local

Requiere Node.js 22.13 o posterior con el módulo integrado `node:sqlite`. Se verificó en este equipo con Node.js 25.

```sh
npm install --include=optional --prefer-online
npm run dev
```

Abrir [FLOW WAR](http://localhost:4173). El mismo proceso sirve React, Express y Socket.IO.

Al iniciar por primera vez, se generan una credencial docente y credenciales independientes para cada empresa/rol en `.local/access.json`. Ese archivo es privado, se excluye de Git y se bloquea su acceso desde HTTP. La aplicación no incluye un selector que otorgue permisos al elegir un rol.

1. Entrar a `/login` con la credencial cuya etiqueta es `Docente`.
2. En la consola, iniciar la partida y abrir la arena.
3. Distribuir las credenciales de los equipos desde `CREDENCIALES`. Cada participante usa su propio dispositivo o sesión de navegador.
4. Las credenciales de participantes abren automáticamente su espacio de trabajo.

La consola permite iniciar, pausar, reanudar, finalizar y restablecer una partida, escoger 20 o 25 minutos para una partida nueva y acelerar el tiempo para ensayos. El primer prototipo permite iniciar con participantes aún desconectados; la comprobación obligatoria de presencia de los 25 roles queda para una ampliación.

Para otros dispositivos en la misma red, usar la dirección IP del host y el puerto 4173, sujeto a la configuración de red y firewall. El prototipo se sirve por HTTP en desarrollo y está destinado a una red local de confianza. El despliegue fuera de esa red requiere HTTPS y configuración de operación.

## Lo que ya funciona

- Arena 8-bit en Canvas con arquitectura, sprites, colas, cinco empresas seleccionables, métricas, clasificación, registro de eventos y controles de zoom.
- Diseño adaptable a pantalla estrecha: empresas en una tira horizontal, arena y paneles debajo.
- Acceso por credencial y validación en servidor de empresa, rol y etapa.
- Backend y Seguridad con React Flow: añadir por clic o arrastre, conectar puertos, mover piezas, cambiar parámetros y guardar borradores.
- Grafos desconectados guardables como borrador; el envío a QA requiere una ruta ejecutable.
- Artefactos inmutables, suites seleccionadas por QA, informes observados y aprobación/rechazo humano.
- Autorización de costos por CTO y reserva de saldo; DevOps ejecuta Rolling o Restart Replace.
- Escalamiento manual de aplicación y activación de balanceador por DevOps; presupuesto operativo autorizado por CTO.
- Carga gradual, solicitudes hostiles, ráfagas de concurrencia, sobreventa, duplicación, presión, reputación, migración y eliminación.
- Migración agregada con conservación de mercado y eventos; el tráfico visual ordinario representa solicitudes reales.
- Sonido arcade opcional, silenciable desde el encabezado cuando el ancho disponible lo permite.
- Persistencia SQLite, comandos deduplicados, reconexión y recuperación en pausa tras reiniciar el servidor.

## Límites actuales respecto al diseño objetivo

La [Entrega 1 de concurrencia](07-entrega-1-concurrencia.md) reemplaza la ráfaga agregada por dos solicitudes individuales sobre una unidad del SKU LAST-UNIT. QA Concurrencia y producción usan el mismo ejecutor, con inventario, resultados y contexto persistentes e independientes. Read, Write, Atomic y Payment se ejecutan por solicitud; las demás piezas de backend alcanzables se rechazan explícitamente en ese escenario hasta implementar su semántica.

La [Entrega 2](08-entrega-2-trafico-colas.md) migra el tráfico ordinario y QA Carga al ejecutor individual con capacidad, FIFO, deadlines, resultados y contabilidad. Concurrencia conserva LAST-UNIT; Regresión, Seguridad e Integración todavía usan fixtures agregados. No se ejecuta una base de 5,000 clientes con fidelización persistente entre visitas. Queue como pieza configurable, caché, locks, retries y resolución automática de transacciones pendientes siguen sin implementarse; la cola básica de infraestructura sí es real.

Los costos actuales cubren servidores, publicaciones, ventas y compensaciones simuladas. La cotización independiente de operación por pieza y el aprovisionamiento diferido de servidores pertenecen a la siguiente iteración. El escalamiento actual es inmediato dentro del presupuesto autorizado.

Producto tiene una vista de métricas y eventos. Propuestas comerciales, rollback, Blue-Green, autoscaling, múltiples salas y rotación de credenciales desde la consola quedan pendientes. No hay journal completo de ticks: se persiste cada segundo real y por comando confirmado. Una caída pierde lo posterior al último snapshot; a 20× esto puede representar unos 20 segundos simulados, además de retrasos del host. Snapshot, recibos y deduplicación de comandos se confirman en una misma transacción.

## Verificación

```sh
npm test
npm run build
```

La suite cubre permisos, privacidad de proyecciones, conexión y orden de bloques, carrera de inventario, pipeline, evidencia QA, reserva y expiración de costos, conservación del mercado, determinismo, pausa y eliminación. Una prueba adicional inicia un servidor aislado y ejecuta el pipeline por conexiones Socket.IO con credenciales separadas, incluidos reintentos del mismo comando.

También se verificó en el navegador la selección de empresas, clasificación, inicio y recuperación de partida, acceso privado, adición de una pieza, conexión de sus dos puertos, guardado, envío a QA, corrida de concurrencia, aprobación de QA, autorización de CTO y ejecución del despliegue desde DevOps.

## Producción local

```sh
npm run build
npm start
```

Datos y sesiones permanecen en `.local/game.sqlite`. `FLOW_PORT` permite cambiar el puerto y `FLOW_DATA_DIR` permite aislar datos de ensayos sin tocar la partida principal.

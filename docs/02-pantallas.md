# FLOW WAR — pantallas y componentes

## 1. Inventario de pantallas

| ID | Ruta propuesta | Audiencia | Propósito |
| --- | --- | --- | --- |
| S01 | `/join` | Participante | Introducir código de sala y credencial de rol. |
| S02 | `/room/:id/arena` | Proyector | Mostrar competencia, arquitectura y tráfico de la empresa enfocada. |
| S03 | `/room/:id/company/:companyId/backend` | Backend | Construir y enviar cambios de lógica. |
| S04 | `/room/:id/company/:companyId/security` | Seguridad | Construir y enviar cambios de protección. |
| S05 | `/room/:id/company/:companyId/qa` | QA | Ejecutar suites y decidir sobre cambios. |
| S06 | `/room/:id/company/:companyId/cto` | CTO | Autorizar costos, riesgos y prioridades. |
| S07 | `/room/:id/company/:companyId/devops` | DevOps | Operar infraestructura y desplegar versiones autorizadas. |
| S08 | `/room/:id/company/:companyId/product` | Producto opcional | Observar experiencia comercial y proponer cambios. |
| S09 | `/room/:id/control` | Docente | Preparar y controlar la partida. |
| S10 | `/room/:id/results` | Audiencia autorizada | Mostrar clasificación final y métricas observadas. |

La sesión determina la ruta de entrada. No hay un selector de rol operativo durante la partida ni pestañas para abrir los controles de otro participante. Una ruta ajena produce acceso denegado, sin cargar sus datos.

## 2. Componentes compartidos

| Componente | Contenido y comportamiento |
| --- | --- |
| `GameHeader` | FLOW WAR, empresa/rol, tiempo restante, estado de conexión y estado de partida. |
| `RoleShell` | Contenedor propio del rol; monta únicamente sus paneles y acciones. |
| `MetricReadout` | Valor, unidad y ventana temporal. Nunca convierte una métrica en una recomendación. |
| `ChangeTimeline` | IDs, versiones, estados y tiempos del pipeline; botones solo de la etapa del rol actual. |
| `EventFeed` | Eventos confirmados por servidor, con fecha de simulación y audiencia filtrada. |
| `ArcadePopupLayer` | Consecuencias breves vinculadas a un evento real; agrupa repeticiones por segundo. |
| `ConnectionBanner` | `RECONECTANDO`, última sincronización y comandos pendientes. |
| `GameStatusOverlay` | Espera, pausa, eliminación de la empresa o final de partida. |

La reputación y las métricas pueden ser visibles en varias pantallas; los controles de modificación conservan exclusividad. Por ejemplo, QA puede leer el costo de un cambio pero no autorizarlo.

## 3. S01 — acceso y espera

Componentes:

- Marca pixelada y estado del servidor.
- Campo de código de sala y campo de credencial privada, sin exponerla en URL.
- Botón `ENTRAR`.
- Una vez autenticado: nombre de empresa, color, rol asignado y estado `ESPERANDO INICIO`.

No hay tutorial, recomendaciones de rol ni cuentas compartidas por empresa. Los mensajes de error se limitan a credencial inválida, sala inexistente, sesión vencida o acceso revocado.

## 4. S02 — pantalla principal proyectada

Composición de referencia para 1920 × 1080:

| Zona | Proporción aproximada | Componentes |
| --- | --- | --- |
| Encabezado | Alto 80 px | Marca, reloj de 25:00, número de sala y estado de simulación. |
| Lateral izquierdo | Ancho 300 px | Cinco tarjetas seleccionables, ordenadas por ranking actual. |
| Arena central | Espacio dominante | Arquitectura top-down y sprites en movimiento. |
| Franja inferior | Alto 160 px | Métricas de empresa enfocada, eventos y migraciones recientes. |

Cada tarjeta de empresa contiene nombre, color e identificador, porcentaje de mercado, capital, presión de abandono y estado `ESTABLE`, `EN RIESGO` o `COLAPSO`. Una empresa eliminada conserva su tarjeta con `FUERA` y mercado 0%. Seleccionarla muestra su arquitectura detenida y sus datos finales.

El mapa representa entrada, web, autenticación, checkout, inventario, pagos y salida. El balanceador y los servidores se ven cuando están presentes en producción. Caminos ortogonales conectan módulos; los sprites recorren esos caminos. Las colas se acumulan junto al servicio que espera, sin teletransportarse ni desaparecer para disimular saturación.

La empresa enfocada determina el mapa. Su selección no altera visitas, mercado ni la pantalla de los roles. El proyector puede elegir empresa y silenciar sonido, sin controles de ingeniería.

Datos en el mapa:

- Clientes entrando, solicitudes procesadas y salidas.
- Profundidad de cola por servicio y utilización medida.
- Resultado de rechazo, error, timeout o compra con símbolo y color.
- Versión de producción y estado visible de un despliegue en curso.
- Migraciones hacia otras empresas: el sprite sale hacia el borde con el emblema del destino. Si la receptora está enfocada, se ve entrar con su color anterior.
- En la franja inferior, un pequeño mapa de cinco empresas permite seguir las transferencias aunque sus arquitecturas no estén enfocadas.

Popups permitidos: `+5 CLIENTES`, `-12 REPUTACIÓN`, `+Q450`, `CRITICAL`, `QUEUE OVERLOAD`, `DEPLOY FAILED`, `SECURITY BREACH`. Cada uno identifica el servicio o empresa afectada. No se muestran pérdidas ficticias para animar la escena.

Las alertas publican hechos observados, como accesos indebidos confirmados, pagos duplicados o cola desbordada. No revelan el calendario futuro de incidentes ni el bloque que resolvería el problema.

## 5. S03 — Backend

Distribución:

- Encabezado privado con empresa, rol, reloj y versión de producción.
- Estante izquierdo con piezas `Stock Validation`, `Atomic Update`, `Lock`, `Retry`, `Queue`, `Idempotency` y `Cache`.
- Lienzo central React Flow con puntos de entrada/salida fijos y módulos operativos del dominio.
- Inspector derecho del nodo seleccionado: ID, puertos, parámetros, costo de incorporación y costo operativo.
- Franja inferior con revisión del borrador, versión base, estado del envío y botón `ENVIAR A QA`.
- Historial de sus cambios con resultados recibidos y estado del pipeline, sin acciones de QA, CTO o DevOps.

Interacciones: arrastrar piezas al lienzo, moverlas, unir puertos, eliminar conexiones y editar parámetros. Zoom, desplazamiento y deshacer afectan el borrador. La opción `PRODUCCIÓN` abre su grafo publicado de solo lectura; `BORRADOR` regresa a la edición.

Los nodos muestran nombre, puertos y configuración; no muestran etiquetas de calidad, estrellas, porcentaje de éxito ni una configuración recomendada. No hay botón `EVALUAR PLAN` ni vista previa de ganancias esperadas.

Un error estructural puede indicar `PUERTO INCOMPATIBLE`, `CICLO NO SOPORTADO` o `FALTA SALIDA`, porque el grafo no es ejecutable. Una solución ejecutable pero ineficaz puede enviarse, probarse y publicarse.

Enviar congela una revisión; continuar trabajando crea otra revisión sin alterar la que está en QA. Las posiciones de nodos se guardan, pero moverlos sin cambiar conexiones o parámetros no altera la ejecución.

## 6. S04 — Seguridad

Comparte la composición del editor de Backend, con un dominio y permisos distintos.

- Estante: `Auth`, `Role Check`, `Rate Limit`, `IP Block`, `WAF`, `Bot Detection`.
- Lienzo: entrada de solicitudes, piezas de seguridad y salida hacia aplicación.
- Inspector: alcance de rutas, límites, intervalos, reglas y costos.
- Métricas privadas: solicitudes bloqueadas, accesos indebidos observados, rechazos legítimos detectados y tráfico recibido.
- Acciones: editar su borrador y `ENVIAR A QA`.

No puede editar lógica de inventario, agregar servidores, ejecutar pruebas ni desplegar. Los rechazos legítimos se miden con las etiquetas internas de la simulación; no se expone la identidad de futuros ataques.

## 7. S05 — QA

Componentes:

- Bandeja de cambios de su empresa, con ID, dominio, autor, revisión, versión base y tiempo de recepción.
- Vista de artefacto inmutable y diff respecto a la base; lectura del grafo, sin edición.
- Cinco suites disponibles al mismo nivel: `CONCURRENCIA`, `REGRESIÓN`, `CARGA`, `SEGURIDAD`, `INTEGRACIÓN`.
- Botón `EJECUTAR` sobre la suite elegida y estado de corrida.
- Tabla de resultados por ejecución: escenario, solicitudes, éxitos, errores, latencia, invariantes comprobadas y fallos observados.
- Botones `APROBAR` y `RECHAZAR`, y campo opcional de observación humana.
- Historial de decisiones de QA.

Ninguna suite aparece preseleccionada en función del incidente, destacada como mejor opción o acompañada de una recomendación. QA ve datos del escenario que acaba de ejecutar, sin un dictamen global del plan ni pronóstico de producción.

Ejemplo de resultado permitido: `100 compras / 94 completadas / 6 rechazadas / 3 cobros duplicados`. Ejemplo de aserción factual: `stock >= 0: incumplida`. La conclusión de aceptar o rechazar pertenece a QA.

La acción de aprobar se habilita después de una suite terminada y sin corridas activas. Un resultado con fallos no bloquea automáticamente la decisión; si QA lo acepta, queda registro de esa decisión. No hay botones para autorizar costos ni desplegar.

## 8. S06 — CTO

Componentes:

- Capital, saldo reservado, saldo disponible y gasto operativo por minuto.
- Bandeja de cambios aprobados por QA: hash/revisión, resultados, máximo de publicación, presupuesto de operación y duración, versión base y tiempo de autorización.
- Botones `AUTORIZAR COSTO` y `RECHAZAR`; registro opcional de aceptación de riesgo.
- Opción explícita de autorizar rollback a la base, con su costo máximo separado.
- Solicitudes de presupuesto de DevOps: monto, duración, operaciones permitidas y máximo de servidores.
- Lista de incidentes observados y control de prioridad de atención.
- Reputación, mercado, ingresos y pérdidas potenciales acumuladas de su empresa.

Priorizar cambia el orden de las bandejas y el marcador de prioridad visible al equipo. No reduce incidentes por sí mismo ni genera soluciones. Autorizar costo reserva dinero; no publica el cambio.

No hay lienzo editable, controles de servidores, selector de estrategia ni botón de despliegue.

## 9. S07 — DevOps / SRE

Componentes:

- Infraestructura visual con entrada, balanceador, servidores y conexión a servicios de datos.
- Nodos de servidor con estado, capacidad, utilización y costo por segundo simulado.
- Acciones `+1 SERVER` y `-1 SERVER` dentro de alcance presupuestado.
- Configuración de balanceador y solicitud de ampliación de presupuesto al CTO.
- Panel de staging: identifica el artefacto probado y sus resultados; no es una segunda partida ni consume mercado.
- Bandeja de cambios autorizados: versión base, revisión, reserva y vencimiento.
- Selector de estrategia disponible y costo: `ROLLING` o `RESTART REPLACE` en el MVP; `BLUE-GREEN` en una ampliación.
- Botón `DEPLOY`, progreso, resultado y versión activa.
- Acción de rollback únicamente cuando existe autorización válida.

La interfaz muestra el tiempo operativo y la capacidad requerida por la estrategia, sin recomendar cuál escoger. El motor aplica su curva real de disponibilidad.

DevOps no puede editar grafos de aplicación o seguridad, aprobar QA ni aprobar costos. Un botón deshabilitado muestra solo la condición factual, como `SIN AUTORIZACIÓN` o `PRESUPUESTO AGOTADO`.

El escalamiento manual y el balanceador forman parte del MVP. Autoscaling y Blue-Green se especifican como ampliaciones posteriores; no aparecen como controles funcionales hasta implementarse.

## 10. S08 — Producto / UX, opcional

Componentes:

- Embudo observado: navegación, entrada a checkout, compra, abandono y rechazo.
- Satisfacción derivada de experiencias atendidas y motivos de salida observados, con tamaño de muestra.
- Catálogo neutral de propuestas funcionales y promociones: nombre, configuración, costo y duración, sin puntaje ni orden por beneficio.
- Borrador de una propuesta y botón `ENVIAR A QA`.
- Historial de propuestas y resultado comercial después de producción.

Una promoción aumenta intención de compra y puede reducir margen, generar más carga o aumentar la demanda de inventario. No concede clientes por pulsar un botón. Su publicación sigue QA → CTO → DevOps.

El rol está desactivado en el núcleo obligatorio. Activarlo antes del inicio lo habilita para las cinco empresas por igual. No se habilita para una sola empresa a mitad de partida.

## 11. S09 — consola docente

Acceso con credencial de operador independiente. Componentes:

- Crear sala con nombre, semilla, duración de 20 o 25 minutos y escenario versionado.
- Cinco empresas y presencia por rol; emisión y revocación de credenciales individuales.
- Enlace de proyección con acceso de solo lectura.
- Controles `INICIAR`, `PAUSAR`, `REANUDAR`, `FINALIZAR` y `RESTABLECER SALA`.
- Estado del host: retraso de ticks, última persistencia y conexiones.
- Descarga del registro de eventos y resultados finales.

El inicio normal requiere cinco roles conectados por empresa y una sesión de proyector. No se incorporan controles para regalar capital, reparar empresas, saltar QA o inyectar soluciones durante una partida.

## 12. S10 — resultados finales

Clasificación pública ordenada por mercado final; desempate por reputación, después capital y, si persiste, empate compartido. Una empresa eliminada se ordena después de las supervivientes; entre eliminadas, sobrevive mejor clasificada la que salió más tarde.

Muestra mercado, clientes, capital, reputación, errores, ingresos potenciales perdidos, migraciones, tiempo fuera de servicio y despliegues. Un empate no se rompe con un indicador secreto.

Las decisiones y reportes privados de cada equipo siguen visibles solo para las audiencias autorizadas y el docente. La pantalla no califica planes ni ofrece una solución al terminar.

## 13. Dirección visual

| Elemento | Especificación inicial |
| --- | --- |
| Fondo | Azul casi negro `#10121C`, retícula sutil y paneles `#1C2233`. |
| Empresa 1 | Amarillo `#FFD54A`. |
| Empresa 2 | Verde `#65DC8C`. |
| Empresa 3 | Azul `#5FA9FF`. |
| Empresa 4 | Rojo `#FF6868`. |
| Empresa 5 | Morado `#BA8CFF`. |
| Texto | Marfil `#F2EED8`; datos secundarios con contraste suficiente sobre panel. |
| Tipografía | Fuente pixel local para marca y titulares breves; monoespaciada legible para tablas y cifras. Verificar licencia antes de incorporarla. |
| Formas | Bordes escalonados, sombras sólidas desplazadas y esquinas rectas. |
| Sprites | Pequeños bloques o personajes pixelados; escalado nítido sin suavizado. |
| Estados | Texto e icono además de color; empresa identificada por número, nombre y emblema. |
| Animación | Movimiento de solicitudes, números flotantes y transición visible de despliegue. |
| Sonido | Opcional y silenciable; beep, deploy y alertas, sujeto a etapa posterior. |

El mapa ocupa la mayor superficie de la pantalla principal. Las métricas acompañan el recorrido visible de los clientes. No hay una cuadrícula de tarjetas como centro de la experiencia.

La tipografía pixel no se usa para párrafos extensos. La opción de movimiento reducido elimina sacudidas y popups flotantes, conserva contadores y trayectorias simplificadas. Los eventos siguen disponibles en un registro textual y los controles tienen etiquetas, foco de teclado y tamaños utilizables.

## 14. Estados de interacción

| Estado | Presentación |
| --- | --- |
| Partida no iniciada | Datos iniciales y espera; sin comandos de juego. |
| Sin cambios pendientes | Bandeja vacía con `0 CAMBIOS`; sin mensaje orientador. |
| Guardando | Revisión pendiente de ACK; no se afirma que el borrador ya está guardado. |
| Conflicto de versión | `VERSIÓN CAMBIÓ`; conserva copia local y permite recargar el estado actual. |
| Reconectando | Últimos datos marcados como desactualizados; comandos bloqueados hasta resync. |
| Pausa | Reloj, eventos, pruebas, costos y despliegues detenidos en tiempo de juego. |
| Colapso | Tráfico y métricas continúan; todavía se puede actuar hasta la eliminación. |
| Eliminada | Arquitectura detenida, datos finales y acciones de juego inhabilitadas. |
| Finalizada | Datos congelados y acceso a clasificación. |

No se añade texto como “te conviene”, “prueba esta suite”, “coloca este bloque” o “tu plan está mal”. Las etiquetas de permisos, errores de formato y resultados observados son información operativa.

import type { Role } from './types.js';

/**
 * Mandatory, scripted tutorials: one per role, played on an isolated practice copy of the engine
 * (server/tutorial.ts) after the team draw and before the game starts. This is the one deliberate exception to
 * "the interface carries no help": it exists only for training, it is not AI, and it never advises during play.
 *
 * Each step spotlights a real element of the workspace and says in one or two sentences what to do and why.
 * - `read`: a pure reading step, the only kind with an ENTENDIDO button.
 * - `ui`: done when the student reaches a UI state (`check`, evaluated in src/tutorial/checks.ts).
 * - `action`: done only when the server confirms the real command on the practice copy.
 * Student-facing strings are Spanish on purpose, in the voseo the rest of the interface uses.
 */
export type TutorialRole = Role | 'auditor';
export type TutorialKind = 'read' | 'ui' | 'action';
export type TutorialStep = {
  id: string; kind: TutorialKind; title: string; text: string;
  /** CSS selector of the element to spotlight; without it the card stands in the middle of a dimmed screen. A list
   * is tried in order: the later ones are where to recover when a reload closed the panel the step works in. */
  target?: string | string[];
  /** Shown when the spotlight had to fall back to a later selector of the list. */
  recover?: string;
  /** `ui` steps: the client check that completes it (src/tutorial/checks.ts). */
  check?: string;
};
export type RoleTutorial = { label: string; job: string; steps: TutorialStep[] };

export const TUTORIALS: Record<TutorialRole, RoleTutorial> = {
  backend: {
    label: 'Backend', job: 'Construís el sistema que atiende y cobra: tienda, checkout, inventario, pagos y salida, y la lógica de cada compra.',
    steps: [
      { id: 'backend-rol', kind: 'read', title: 'Tu rol: Backend', target: '.plan-editor',
        text: 'Este es el plano de tu empresa: hoy solo tiene la entrada y la tienda web, así que se puede mirar pero no comprar. Vos ponés las piezas que faltan para vender.' },
      { id: 'backend-piezas', kind: 'ui', check: 'plan-own-placed', title: 'Colocá tus piezas', target: '.plan-editor .editor-flow',
        text: 'Tocá cada solar vacío con el signo +: Salida, Checkout, Inventario y Pagos. Sin ellos la tienda muestra productos pero no puede cobrar.' },
      { id: 'backend-caminos', kind: 'ui', check: 'plan-roads', title: 'Dibujá el recorrido de la compra', target: '.plan-editor .editor-flow',
        text: 'Arrastrá desde el punto derecho de cada pieza hasta el punto izquierdo de la siguiente: Tienda web → Checkout → Inventario → Pagos → Salida. Ese es el camino que hace cada compra.' },
      { id: 'backend-publicar', kind: 'action', title: 'Publicá el plano', target: '.plan-editor',
        text: 'Tocá PUBLICAR. Mientras la empresa está en montaje publicás directo; desde la primera venta, todo cambio pasa por el ciclo completo.' },
      { id: 'backend-sobreventa', kind: 'read', title: 'Mirá esta venta doble', target: '.plan-editor .react-flow__node[data-id="plan-inventory"]',
        text: 'Dos clientes compraron a la vez la última unidad y se cobraron las dos compras: vendiste una unidad que no existía. Eso es una sobreventa, y se arregla en la lógica del inventario.' },
      { id: 'backend-inventario', kind: 'ui', check: 'logic-panel-open', title: 'Tocá Inventario', target: ['.plan-editor .react-flow__node[data-id="plan-inventory"]', '.plan-editor'],
        text: 'Tocá la pieza Inventario: debajo del plano aparece su lógica, con los bloques que le podés poner.' },
      { id: 'backend-atomic', kind: 'ui', check: 'atomic-connected', title: 'Poné Atomic Update', target: ['.plan-logic', '.plan-editor'], recover: 'Primero tocá la pieza Inventario.',
        text: 'Tocá PONER en Atomic Update: el juego lo ubica entre Read Stock y Write Stock. Así el stock se descuenta de a una compra y la segunda queda rechazada.' },
      { id: 'backend-enviar', kind: 'action', title: 'Enviá el cambio a Seguridad', target: ['.plan-logic', '.plan-editor'], recover: 'Primero tocá la pieza Inventario.',
        text: 'Tocá ENVIAR A SEGURIDAD. Ningún cambio llega a producción sin pasar por Seguridad → QA → CTO → DevOps.' },
      { id: 'backend-fin', kind: 'read', title: '¡Listo!', target: '.return-inbox',
        text: 'Tu cambio quedó en Seguridad y tu lógica queda bloqueada mientras se revisa. Si QA te devuelve una carta, aparece acá y podés corregir.' },
    ],
  },
  security: {
    label: 'Seguridad', job: 'Decidís qué tráfico se filtra antes de llegar a la tienda y qué controles tiene cada bloque que entrega Backend.',
    steps: [
      { id: 'seguridad-rol', kind: 'read', title: 'Tu rol: Seguridad', target: '.plan-editor',
        text: 'Este es el plano de tu empresa. Tu pieza es el perímetro: filtra lo que entra antes de que llegue a la tienda. Además, todo cambio de Backend pasa por vos antes de QA.' },
      { id: 'seguridad-perimetro', kind: 'ui', check: 'plan-own-placed', title: 'Colocá el perímetro', target: '.plan-editor .editor-flow',
        text: 'Tocá el solar vacío Seguridad. Sin perímetro, cualquiera entra como si fuera un cliente.' },
      { id: 'seguridad-publicar', kind: 'action', title: 'Conectalo y publicá', target: '.plan-editor',
        text: 'Arrastrá de Entrada a Seguridad y de Seguridad a Tienda web, y tocá PUBLICAR. Hacelo antes de la primera venta: en montaje se publica directo.' },
      { id: 'seguridad-cambio', kind: 'ui', check: 'security-module-selected', title: 'Abrí lo que entregó Backend', target: '.security-editor-body',
        text: 'Backend te entregó el módulo Inicio de sesión. Su verificación de sesión se puede saltear: tocá el bloque Inicio de sesión para ver su protección.' },
      { id: 'seguridad-controles', kind: 'action', title: 'Activá los controles del bloque', target: '.security-editor-body',
        text: 'Marcá Auth, Role Check, WAF y Bot Detection y tocá GUARDAR CONTROLES. Auth exige una sesión verificada: con eso nadie se saltea el inicio de sesión.' },
      { id: 'seguridad-entregar', kind: 'action', title: 'Entregá la revisión a QA', target: '.node-editor:has(.security-editor-body)',
        text: 'Tocá ENTREGAR REVISIÓN y después CONFIRMAR ENTREGA A QA. QA va a probar exactamente esta combinación de lógica y controles.' },
      { id: 'seguridad-fin', kind: 'read', title: '¡Listo!', target: '.security-editor-body',
        text: 'Lo que no protejas lo pueden encontrar QA en sus pruebas o los auditores externos en producción, y a la empresa le cuesta plata y reputación hasta que lo cierres.' },
    ],
  },
  qa: {
    label: 'QA', job: 'Probás cada cambio en una copia aislada (staging) y decidís con evidencia si sigue al CTO o vuelve a quien lo hizo.',
    steps: [
      { id: 'qa-rol', kind: 'read', title: 'Tu rol: QA', target: '.team-console',
        text: 'Backend y Seguridad ya te entregaron un cambio. Nada llega a producción sin que lo pruebes vos: tus pruebas corren en staging y no tocan a los clientes reales.' },
      { id: 'qa-abrir-caso', kind: 'ui', check: 'qa-manual-open', title: 'Abrí la configuración del caso', target: '.editor-history fieldset > details',
        text: 'En OPERACIONES DEL DEPARTAMENTO abrí CONFIGURACIÓN MANUAL AVANZADA: ahí armás un caso de prueba exacto.' },
      { id: 'qa-ejecutar', kind: 'action', title: 'Probá la última unidad', target: '.editor-history fieldset > details',
        text: 'Elegí SUITE concurrency, SOLICITUDES 2, STOCK 1 y SIMULTÁNEAS 2, y tocá EJECUTAR CASO: dos clientes compran a la vez la última unidad.' },
      { id: 'qa-leer', kind: 'read', title: 'Leé el resultado', target: '.evidence-lab',
        text: 'Acá está la corrida: compras completadas, rechazadas y sobreventas. Si hay sobreventas, el cambio no protege la última unidad.' },
      { id: 'qa-evidencia', kind: 'ui', check: 'qa-evidence-checked', title: 'Adjuntá la evidencia', target: '.evidence-selector',
        text: 'Marcá la casilla de la corrida: es la prueba que respalda tu decisión y la que va a leer el CTO.' },
      { id: 'qa-aprobar', kind: 'action', title: 'Escribí tu evaluación y aprobá', target: '.team-console',
        text: 'Con la corrida marcada, escribí en RIESGOS OBSERVADOS qué probaste y por qué puede seguir, y tocá APROBAR CON EVIDENCIA SELECCIONADA. El cambio pasa al CTO.' },
      { id: 'qa-carta', kind: 'ui', check: 'qa-letter-open', title: 'Así se devuelve un cambio', target: '.qa-letter > details',
        text: 'Cuando una prueba muestra un problema, no aprobás: abrí REDACTAR CARTA FORMAL DE DEVOLUCIÓN.' },
      { id: 'qa-carta-campos', kind: 'read', title: 'La carta de devolución', target: '.qa-letter > details',
        text: 'Elegís a quién va (Backend o Seguridad), contás el problema, cómo reproducirlo, qué observaste y qué esperabas, con la evidencia marcada. Al enviarla, el cambio vuelve a esa persona para corregirlo.' },
    ],
  },
  cto: {
    label: 'CTO', job: 'Manejás la plata: autorizás cuánto puede gastar DevOps y qué cambios se publican, siempre con un motivo escrito.',
    steps: [
      { id: 'cto-rol', kind: 'read', title: 'Tu rol: CTO', target: '.cto-console',
        text: 'Arriba ves el capital, lo reservado y lo disponible. Cada gasto de la empresa pasa por una autorización tuya.' },
      { id: 'cto-alcance', kind: 'action', title: 'Autorizá el alcance de DevOps', target: '.cto-console .scope-panel:has(.request-list)',
        text: 'DevOps pidió presupuesto: completá MONTO, DURACIÓN y MÁX. SERVIDORES, marcá ESCALAR y BALANCEADOR y tocá AUTORIZAR ALCANCE. REVISAR copia lo que pidió.' },
      { id: 'cto-abrir', kind: 'ui', check: 'cto-decision-open', title: 'Abrí el panel de decisión', target: '.cto-manual',
        text: 'QA aprobó un cambio con evidencia. Abrí REGISTRAR DECISIÓN DIRECTAMENTE para decidir sobre él.' },
      { id: 'cto-decision', kind: 'action', title: 'Autorizá el cambio con un motivo', target: '.cto-manual',
        text: 'Elegí Autorizar publicación, escribí el motivo, marcá la confirmación y tocá CONFIRMAR DECISIÓN.' },
      { id: 'cto-fin', kind: 'read', title: '¡Listo!', target: '.cto-manual',
        text: 'Autorizar reserva el costo y le da a DevOps 60 s para publicar. Si la evidencia no te convence, pedís más a QA o rechazás: el cambio vuelve a QA.' },
    ],
  },
  devops: {
    label: 'DevOps', job: 'Operás la infraestructura: servidores, balanceador y despliegues, dentro del alcance que autoriza el CTO.',
    steps: [
      { id: 'devops-rol', kind: 'read', title: 'Tu rol: DevOps', target: '.infra-panel',
        text: 'Esta es tu infraestructura en producción: un servidor de aplicación atiende la tienda web y el checkout. El CTO ya te autorizó escalar hasta 3 servidores.' },
      { id: 'devops-servidor', kind: 'action', title: 'Agregá un servidor', target: '.infra-actions',
        text: 'Tocá +1 SERVER. Más servidores atienden a más clientes a la vez, y cada uno cuesta Q0.50 por segundo.' },
      { id: 'devops-balanceador', kind: 'action', title: 'Activá el balanceador', target: '.infra-actions',
        text: 'Sin balanceador solo APP-01 recibe tráfico y el servidor nuevo queda ocioso. Tocá ACTIVAR BALANCEADOR para repartir la carga.' },
      { id: 'devops-deploy', kind: 'action', title: 'Desplegá el cambio autorizado', target: '.deploy-panel .deploy-actions:not(.rollback-actions)',
        text: 'Elegí la ESTRATEGIA y tocá DEPLOY. ROLLING cambia los servidores de a uno (6 s, se sigue atendiendo con menos capacidad); RESTART REPLACE los reemplaza juntos (3 s, sin atender mientras dura).' },
      { id: 'devops-rollback', kind: 'read', title: 'Dónde está el rollback', target: '.rollback-actions',
        text: 'Si una versión falla, el CTO autoriza volver a una anterior y vos la ejecutás acá: elegís la estrategia y tocás EJECUTAR ROLLBACK.' },
    ],
  },
  product: {
    label: 'Producto / UX', job: 'Mirás cómo se comportan los clientes y preparás promociones del catálogo, que publican QA, CTO y DevOps.',
    steps: [
      { id: 'producto-rol', kind: 'read', title: 'Tu rol: Producto / UX', target: '.product-console > section:nth-of-type(1)',
        text: 'El embudo muestra cuántos clientes navegan, entran al checkout y compran. Con eso decidís qué promoción preparar.' },
      { id: 'producto-borrador', kind: 'action', title: 'Prepará una promoción', target: '.product-console > section:nth-of-type(2)',
        text: 'Elegí una OPCIÓN del catálogo, completá sus parámetros dentro de los rangos y tocá GUARDAR BORRADOR.' },
      { id: 'producto-enviar', kind: 'action', title: 'Enviala a QA', target: '.product-console > section:nth-of-type(3)',
        text: 'Tocá ENVIAR A QA en tu borrador. Desde ese momento la configuración queda congelada.' },
      { id: 'producto-fin', kind: 'read', title: '¡Listo!', target: '.product-console > section:nth-of-type(4)',
        text: 'QA la prueba en staging, el CTO la autoriza y DevOps la publica. Acá abajo queda el historial de cada campaña.' },
    ],
  },
  auditor: {
    label: 'Auditor externo', job: 'Probás los controles de las cinco empresas en producción con tráfico anómalo simulado.',
    steps: [
      { id: 'auditor-rol', kind: 'read', title: 'Tu rol: auditor externo', target: '.auditor-intro',
        text: 'No sos de ninguna empresa: revisás las cinco. Cada hueco que encontrás le cuesta a la empresa hasta que lo cierra.' },
      { id: 'auditor-empresa', kind: 'ui', check: 'click', title: 'Elegí una empresa', target: '.auditor-companies',
        text: 'Tocá una de las cinco empresas. El número dice cuántos controles pendientes tiene.' },
      { id: 'auditor-modulo', kind: 'ui', check: 'auditor-module-open', title: 'Abrí un módulo', target: '.auditor-modules',
        text: 'Tocá un módulo en producción, por ejemplo Write Stock, para ver qué le falta.' },
      { id: 'auditor-pendientes', kind: 'read', title: 'Leé sus controles pendientes', target: ['.auditor-pending', '.auditor-modules'], recover: 'Primero tocá un módulo.',
        text: 'Cada línea es un control que ese módulo no tiene. «No verifica la sesión del cliente» quiere decir que le falta Auth.' },
      { id: 'auditor-prueba', kind: 'action', title: 'Lanzá una prueba de control', target: ['.auditor-pending', '.auditor-modules'], recover: 'Primero tocá un módulo.',
        text: 'Tocá LANZAR PRUEBA en un control pendiente: la empresa recibe 30 solicitudes de tráfico anómalo simulado y su configuración decide cuántas contiene.' },
      { id: 'auditor-resultado', kind: 'read', title: 'Leé el resultado', target: '.auditor-status',
        text: 'CONTENIDAS son las que un control detuvo; NO CONTENIDAS, las que pasaron. Si pasan, la empresa paga una multa y sigue perdiendo hasta configurar ese control.' },
    ],
  },
};

export const tutorialFor = (role: TutorialRole) => TUTORIALS[role];

/** What a practicing student sees: the step, facts the engine measured and whether the step can be closed yet. */
export type TutorialView = {
  role: TutorialRole; step: number; total: number; stepId: string;
  /** Read steps: false while the practice copy is still producing what the step talks about. */
  ready: boolean;
  /** Short sentences composed by the server from the practice copy (counts, what went wrong). */
  facts: string[];
  /** Shown while the engine works on the student's action (a test running, a deploy in progress). */
  waiting?: string;
};

/** Progress of one player, kept with the room so a reload or a restart resumes it. */
export type TutorialEntry = { role: TutorialRole; companyId: number | null; step: number; startedAt: number; finishedAt?: number; participantId?: string };
/** Keyed by player: `p:<participant id>` for a room seat, `i:<identity id>` for a credential login. */
export type TutorialState = { generation: number; players: Record<string, TutorialEntry> };

/** The teacher's view: every seated player's progress and whether they are connected now. */
export type TutorialBoardRow = { key: string; participantId?: string; name: string; role: TutorialRole; companyId: number | null; step: number; total: number; finished: boolean; connected: boolean };
export type TutorialBoard = { rows: TutorialBoardRow[]; pending: number; finished: number };

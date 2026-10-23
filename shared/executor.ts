import type { Role } from './types.js';

/** A student instruction for the operational executor. Identity, company and role come from the session. */
export type ExecutorInput = {
  id: string; text: string; threadId?: string;
  /** What the student has selected on their own panel; a reference such as "este cambio" resolves to it. */
  selection?: { changeId?: string; nodeId?: string; serverId?: number; draftId?: string };
};
export type ToolCall = { name: string; input: Record<string, unknown> };
/** Why an instruction produced no operation. Each maps to one fixed server message. */
export type DeclineReason = 'CONSEJO' | 'DECISION_DELEGADA' | 'FUERA_DE_ROL' | 'FUERA_DEL_JUEGO' | 'NO_DISPONIBLE' | 'OTRA_EMPRESA' | 'CAMBIO_DE_REGLAS';
export type OperationOutcome = { tool: string; type?: string; ok: boolean; code?: string; message: string; refs: string[] };
export type ExecutorState = 'EXECUTED' | 'PARTIAL' | 'REJECTED' | 'NEEDS_INPUT' | 'DECLINED' | 'INFORMATION' | 'NO_OPERATION';
export type ExecutorReply = { id: string; state: ExecutorState; message: string; operations: OperationOutcome[]; refs: string[]; provider: string; model: string };
export type ExecutorRole = Exclude<Role, never>;

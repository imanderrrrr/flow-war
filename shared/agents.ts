import type { SimulatedAction } from './actions.js';
import type { Identity, Result } from './types.js';

export type AgentInput = { version: 1; id: string; fixture?: string; rawText?: string; changeId?: string };
export type AgentContext = { identity: Identity; generation: number; tick: number };
export type AgentInterpretation =
  | { version: 1; intent: 'EXECUTE_ACTION' | 'PREPARE_CHANGE' | 'RUN_TEST'; action: SimulatedAction }
  | { version: 1; intent: 'REQUEST_INFORMATION' | 'OUT_OF_ROLE' | 'OUT_OF_SCOPE' | 'AMBIGUOUS' | 'UNSUPPORTED'; action?: SimulatedAction };
export type AgentStatus = 'ORDER_RECEIVED' | 'PREPARED' | 'EXECUTED' | 'SENT_TO_QA' | 'PENDING_AUTHORIZATION' | 'DEPLOY_STARTED' | 'DEPLOY_COMPLETED' | 'UNAUTHORIZED' | 'OUT_OF_ROLE' | 'OUT_OF_SCOPE' | 'AMBIGUOUS' | 'UNSUPPORTED' | 'TECHNICAL_ERROR';
export type AgentResult = Result & { version: 1; status: AgentStatus; message: string };
export interface AgentInterpreter { interpret(input: AgentInput, context: Readonly<AgentContext>): AgentInterpretation | Promise<AgentInterpretation> }

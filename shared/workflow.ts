import type { TestScenario } from './actions.js';
import type { Report } from './types.js';
export type ReturnLetter = { id:string; companyId:number; changeId:string; backendVersion:number; securityRevision:number; recipient:'backend'|'security'; subject:string; description:string; steps:string; observed:string; expected:string; severity:'low'|'medium'|'high'|'critical'; evidenceIds:string[]; author:string; at:number; generation:number; observationRefs:string[]; successorId?:string };
export type QaRun = { threadId?:string; id:string; companyId:number; generation:number; author:string; changeId:string; backendVersion:number; securityRevision:number; bundleDigest:string; request:string; scenario:TestScenario; seed:number; at:number; report?:Report; repeatOf?:string };
export type Decision = { id:string; changeId:string; actor:string; at:number; kind:'qa.approve'|'cto.authorize'|'cto.reject'|'cto.evidence'|'cancel'; reason:string; evidenceIds:string[]; failedIds:string[]; cost?:number };
export type Investment = { id:string; companyId:number; cto:string; department:'backend'|'security'; objective:string; justification:string; maximum:number; reserved:number; spent:number; status:'REQUESTED'|'AUTHORIZED'|'IN_PROGRESS'|'COMPLETED'|'CANCELLED'; at:number; expires:number; changeId?:string; completedBy?:string };
export type WorkflowState = { backendLock?:{featureId:'purchase-flow';changeId:string;at:number}; letters:ReturnLetter[]; runs:QaRun[]; decisions:Decision[]; investments:Investment[] };
export type WorkflowView = Omit<WorkflowState,'runs'> & { runs:Omit<QaRun,'report'>[]; available:number };
export type ConversationMessage = { id:string; requestId:string; role:'user'|'assistant'; text:string; at:number; refs:string[] };
export type Conversation = { id:string; actor:string; role:string; generation:number; companyId:number; messages:ConversationMessage[] };

export type AiAttempt={id:string;actor:string;role:string;generation:number;threadId:string;digest:string;state:string;at:number;finishedAt?:number;code?:string};

import type { Graph } from './types.js';

/** Infrastructure operations a CTO authorization can include. */
export const INFRA_OPERATIONS = ['scale', 'balancer'] as const;
export type InfraOperation = typeof INFRA_OPERATIONS[number];
export type InfraRequest = {
  id: string; companyId: number; requestedBy: string; amount: number; durationSeconds: number; maxServers: number; operations: InfraOperation[];
  status: 'REQUESTED' | 'AUTHORIZED' | 'REJECTED'; at: number; decidedBy?: string; decidedAt?: number; authorizationId?: string;
};
/** The operating scope DevOps may execute: money moved to the operating budget, its window and limits. */
export type InfraAuthorization = {
  id: string; companyId: number; amount: number; durationSeconds: number; maxServers: number; operations: InfraOperation[];
  authorizedBy: string; at: number; expires: number; requestId?: string; status: 'ACTIVE' | 'EXPIRED' | 'SUPERSEDED'; kind: 'initial' | 'cto' | 'legacy';
};
/** A production version and the graphs it published, so a rollback restores exactly a tested version. */
export type ReleaseRecord = { version: number; changeId: string | null; kind: 'initial' | 'deploy' | 'rollback'; at: number; backend: Graph; security: Graph; rollbackOf?: number };
export type RollbackAuthorization = {
  id: string; companyId: number; targetVersion: number; amount: number; reserved: number; spent: number; authorizedBy: string; at: number; expires: number;
  status: 'AUTHORIZED' | 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED' | 'CANCELLED' | 'FAILED'; strategy?: 'rolling' | 'restart'; startedBy?: string; startedAt?: number; due?: number; resultVersion?: number;
};
export type OperationsState = { requests: InfraRequest[]; authorizations: InfraAuthorization[]; releases: ReleaseRecord[]; rollbacks: RollbackAuthorization[] };
export type InfraView = {
  requests: InfraRequest[]; authorizations: InfraAuthorization[]; scope: InfraAuthorization | null; rollbacks: RollbackAuthorization[];
  releases: Omit<ReleaseRecord, 'backend' | 'security'>[]; costPerSecond: number;
};

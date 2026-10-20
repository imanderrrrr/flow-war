import type { Graph } from './types.js';

export type ProtectionRule =
  | { kind: 'authenticated' | 'owner' | 'input' | 'bot' }
  | { kind: 'origin'; origin: string }
  | { kind: 'rate'; limit: number; windowSeconds: number; groupBy: 'origin' | 'customer' };
export type BlockProtection = { nodeId: string; rules: ProtectionRule[] };
export type SecurityDraft = { revision: number; blocks: Record<string, { text: string; rules: ProtectionRule[]; executable: boolean; interpretationId?: string; author: string }>; observations: { nodeId: string; text: string; author: string; at: number }[] };
export type SharedImplementation = {
  featureId: 'purchase-flow'; backendVersion: number; backendAuthor: string; graphDigest: string;
  security?: { revision: number; author: string; at: number; blocks: BlockProtection[]; digest: string };
  bundleDigest?: string;
};
export type AiKind = 'backend.propose' | 'security.propose' | 'security.compile';
export type AiInput = { id: string; kind: AiKind; text: string; changeId?: string; nodeId?: string };
export type AiOutput = { graph?: Graph; text?: string; rules?: ProtectionRule[]; executable?: boolean };
export type AiProposal = { id: string; actor: string; kind: AiKind; companyId: number; generation: number; inputDigest: string; changeId?: string; nodeId?: string; sourceText?: string; output: AiOutput; provider: 'anthropic' | 'test'; model: string; status: 'PENDING' | 'ACCEPTED' | 'REJECTED'; at: number; draftRevision: number };
export type CollaborationState = { nextVersion: number; reviews: Record<string, SecurityDraft>; proposals: AiProposal[] };
export type CollaborationView = { reviews: Record<string, { revision: number; blocks: Record<string, { text: string; executable: boolean; author: string }>; observations: SecurityDraft['observations'] }>; proposals: Omit<AiProposal, 'inputDigest' | 'output' | 'sourceText'>[] };
export type RequestSecurityContext = { authenticated: boolean; ownsPurchase: boolean; maliciousInput: boolean; automated: boolean; origin: string; customerId?: string; type: 'browse' | 'query' | 'purchase' };

export type BlockConfiguration =
  | { kind: 'lock'; resource: 'stock' | 'payment'; ttlMs: number; acquisitionMs: number }
  | { kind: 'queue'; capacity: number; resource: 'stock' }
  | { kind: 'retry'; maxAttempts: number; delayMs: number; condition: 'payment_timeout' }
  | { kind: 'idempotency'; ttlSeconds: number; scope: 'purchase' }
  | { kind: 'cache'; ttlSeconds: number; capacity: number; invalidateOnWrite: boolean }
  | { kind: 'validation'; minimum: number; rejectInvalidInput: boolean };

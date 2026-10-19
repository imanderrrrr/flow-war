// The app runs TypeScript through tsx in both development and production.
import { register } from 'tsx/esm/api';
register();
await import('./dvr-worker.ts');

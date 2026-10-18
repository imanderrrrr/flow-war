import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({ plugins: [react()], server: { fs: { deny: ['**/.local/**', '**/access.json', '**/*.sqlite*', '**/.git/**', '**/.env*', '**/*.{crt,pem}'] } }, build: { target: 'es2022' } });

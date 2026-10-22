import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

/**
 * Pide la clave de Anthropic sin mostrarla y la guarda en .env (ignorado por Git).
 * Uso: npm run setup:anthropic
 */
const envPath = resolve('.env'), examplePath = resolve('.env.example');

function ignoredByGit() {
  try { execFileSync('git', ['check-ignore', '-q', envPath], { stdio: 'ignore' }); return true; }
  catch { return !existsSync(resolve('.git')); }
}
/** Lee una línea sin eco: en terminal muestra un asterisco por carácter; también acepta entrada canalizada. */
function readSecret(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  if (!process.stdin.isTTY) return new Promise(res => { let data = ''; process.stdin.on('data', d => data += d); process.stdin.on('end', () => { process.stdout.write('\n'); res(data.split(/\r?\n/)[0] ?? ''); }); });
  return new Promise(res => {
    let value = '';
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\r' || ch === '\n') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData); process.stdout.write('\n'); res(value); return; }
        if (ch === '\u0003') { process.stdout.write('\nCancelado.\n'); process.exit(1); }
        if (ch === '\u007f' || ch === '\b') { if (value) { value = value.slice(0, -1); process.stdout.write('\b \b'); } continue; }
        if (ch >= ' ') { value += ch; process.stdout.write('*'); }
      }
    };
    process.stdin.on('data', onData);
  });
}

if (!ignoredByGit()) { console.error('.env no está ignorado por Git en este directorio. No se guardó nada.'); process.exit(1); }
const key = (await readSecret('Pegá tu ANTHROPIC_API_KEY y presioná Enter: ')).trim();
if (!key) { console.error('No se ingresó ninguna clave. No se guardó nada.'); process.exit(1); }
if (/^sk-ant-admin/.test(key)) { console.error('Esa es una clave de administración; la API de mensajes necesita una clave estándar (sk-ant-api…). No se guardó nada.'); process.exit(1); }
if (!/^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)) { console.error('El formato no parece una clave de Anthropic (sk-ant-…). No se guardó nada.'); process.exit(1); }

let content = existsSync(envPath) ? readFileSync(envPath, 'utf8') : existsSync(examplePath) ? readFileSync(examplePath, 'utf8') : '';
content = /^ANTHROPIC_API_KEY=.*$/m.test(content) ? content.replace(/^ANTHROPIC_API_KEY=.*$/m, `ANTHROPIC_API_KEY=${key}`) : `${content.replace(/\n?$/, '\n')}ANTHROPIC_API_KEY=${key}\n`;
if (!/^ANTHROPIC_MODEL=\S+/m.test(content)) content = /^ANTHROPIC_MODEL=.*$/m.test(content) ? content.replace(/^ANTHROPIC_MODEL=.*$/m, 'ANTHROPIC_MODEL=claude-opus-5-5') : `${content}ANTHROPIC_MODEL=claude-opus-5-5\n`;
writeFileSync(envPath, content, { mode: 0o600 }); chmodSync(envPath, 0o600);
console.log(`Clave guardada en ${envPath} (permisos 600, ignorado por Git).`);
console.log('Siguiente paso: npm run verify:anthropic');

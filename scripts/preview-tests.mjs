import { cp, lstat, realpath, rm, stat } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preview } from 'vite';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const source = join(root, 'dist');
const target = join(root, '.test-dist');
if (dirname(target) !== root || basename(target) !== '.test-dist') {
  throw new Error('A pasta de testes está fora do projeto.');
}
await stat(join(source, 'index.html')).catch(() => { throw new Error('Execute npm run build antes dos testes de navegador.'); });
try {
  const current = await lstat(target);
  if (!current.isDirectory() || current.isSymbolicLink() || await realpath(target) !== join(await realpath(root), '.test-dist')) {
    throw new Error('A pasta de testes não é um diretório local seguro.');
  }
  // Only this fixed, verified project-local copy may be replaced. Never touch dist.
  await rm(target, { recursive: true, force: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}
await cp(source, target, { recursive: true });
const server = await preview({
  configFile: false,
  root,
  base: './',
  build: { outDir: target },
  preview: { host: 'localhost', port: 4183, strictPort: true },
});
server.printUrls();
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => { server.httpServer.close(() => process.exit(0)); });
}

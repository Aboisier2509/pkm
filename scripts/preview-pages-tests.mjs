import { createServer } from 'node:http';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// This server reads the existing build. It never modifies dist or browser data.
const project = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const output = join(project, 'dist');
const outputStat = await lstat(output).catch(() => {
  throw new Error('Execute npm run build antes do teste de hospedagem.');
});
if (!outputStat.isDirectory() || outputStat.isSymbolicLink() || await realpath(output) !== output) {
  throw new Error('O build deve estar em uma pasta dist local do projeto.');
}
const prefix = '/pkm/';
const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};

function contained(path) {
  return path === output || path.startsWith(`${output}${sep}`);
}

async function safeFile(path) {
  if (!contained(path)) return false;
  // Reject symlinks/junctions at every component before following realpath.
  let current = output;
  for (const component of relative(output, path).split(sep).filter(Boolean)) {
    current = join(current, component);
    if ((await lstat(current)).isSymbolicLink()) return false;
  }
  if (!contained(await realpath(path))) return false;
  return (await lstat(path)).isFile();
}

const server = createServer(async (request, response) => {
  const send = (status, message) => {
    response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : message);
  };
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.setHeader('Allow', 'GET, HEAD');
      send(405, 'Método não permitido.');
      return;
    }
    const url = new URL(request.url ?? '/', 'http://localhost:4184');
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { send(400, 'Endereço inválido.'); return; }
    if (pathname === '/pkm') {
      response.writeHead(308, { Location: `${prefix}${url.search}`, 'Cache-Control': 'no-store' });
      response.end();
      return;
    }
    // No root assets or SPA fallback: incorrect absolute asset URLs must fail.
    if (!pathname.startsWith(prefix) || pathname.includes('\0') || pathname.includes('\\') || pathname.includes(':')) {
      send(404, 'Arquivo não encontrado.');
      return;
    }
    const suffix = pathname.slice(prefix.length);
    if (suffix.split('/').some((part) => part === '.' || part === '..')) {
      send(404, 'Arquivo não encontrado.');
      return;
    }
    const path = resolve(output, suffix || 'index.html');
    if (!await safeFile(path)) { send(404, 'Arquivo não encontrado.'); return; }
    const body = await readFile(path);
    response.writeHead(200, {
      'Content-Type': contentTypes[extname(path).toLowerCase()] ?? 'application/octet-stream',
      'Content-Length': body.byteLength,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    if (response.headersSent) { response.destroy(); return; }
    send(error?.code === 'ENOENT' || error?.code === 'ENOTDIR' ? 404 : 500, 'Arquivo indisponível.');
  }
});

await new Promise((accept, reject) => {
  server.once('error', reject);
  server.listen(4184, 'localhost', accept);
});
process.stdout.write('Teste de hospedagem: http://localhost:4184/pkm/\n');
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => { server.closeAllConnections(); process.exit(0); }, 5_000).unref();
  });
}

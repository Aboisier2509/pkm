import { copyFile, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// Select project source, not the user's whole workspace. In particular, browser
// backups, databases, credentials, caches, build output and test reports stay out.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const target = join(root, 'github-upload');
const markerName = '.pkm-upload-source';
const markerText = 'pkm-github-source-v1\n';
const files = [
  '.editorconfig', '.gitignore', 'README.md', 'index.html',
  'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts',
  'playwright.config.ts', 'playwright.unit.config.ts', 'playwright.pages.config.ts',
  'public/manifest.webmanifest', 'public/icons/icon.svg',
  'public/icons/icon-192.png', 'public/icons/icon-512.png',
];
const allowedDirectories = [
  ['src', new Set(['.ts', '.css'])],
  ['scripts', new Set(['.mjs'])],
  ['tests', new Set(['.ts'])],
  ['docs', new Set(['.md'])],
];

function inside(parent, candidate) {
  const part = relative(parent, candidate);
  return part !== '' && !part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part);
}
const canonicalRoot = await realpath(root);
async function checked(path, directory) {
  const absolute = resolve(root, path);
  if (!inside(root, absolute)) throw new Error('Caminho fora do projeto.');
  const info = await lstat(absolute);
  if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile())) {
    throw new Error(`O caminho nao e um ${directory ? 'diretorio' : 'arquivo'} local: ${path}`);
  }
  if (!inside(canonicalRoot, await realpath(absolute))) throw new Error('Um caminho resolve fora do projeto.');
  return absolute;
}
async function collect(directory, extensions) {
  await checked(directory, true);
  for (const entry of await readdir(join(root, directory), { withFileTypes: true })) {
    // Dot directories never contain required application source in this project.
    if (entry.name.startsWith('.')) continue;
    const path = `${directory}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`Link simbolico recusado: ${path}`);
    if (entry.isDirectory()) await collect(path, extensions);
    else if (entry.isFile() && extensions.has(extname(entry.name))) files.push(path);
  }
}
for (const [directory, extensions] of allowedDirectories) await collect(directory, extensions);
const selected = [...new Set(files)].sort();
// GitHub's browser upload supports up to 100 files and 25 MiB per file.
if (selected.length + 1 > 100) throw new Error('Mais de 100 arquivos: divida o envio ou use GitHub Desktop.');
const sources = await Promise.all(selected.map(async (path) => {
  const absolute = await checked(path, false);
  if ((await lstat(absolute)).size > 25 * 1024 * 1024) throw new Error(`Arquivo excede o envio pelo navegador: ${path}`);
  return { path, absolute };
}));

// Regenerate only our fixed folder, with an ownership marker and path checks.
// Never remove an arbitrary pre-existing folder or follow a symlink/junction.
if (dirname(target) !== root || !inside(root, target)) throw new Error('Pasta de envio fora do projeto.');
try {
  const info = await lstat(target);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(target) !== join(canonicalRoot, 'github-upload')) {
    throw new Error('A pasta github-upload existente nao e um diretorio local seguro.');
  }
  const marker = join(target, markerName);
  const markerInfo = await lstat(marker);
  if (!markerInfo.isFile() || markerInfo.isSymbolicLink() || await readFile(marker, 'utf8') !== markerText) {
    throw new Error('A pasta github-upload nao foi criada por este preparador. Preserve seus arquivos.');
  }
  await rm(target, { recursive: true });
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
  // An existing folder without the ownership marker must also be preserved.
  try { await lstat(target); throw new Error('A pasta github-upload ja existe sem identificacao. Preserve seus arquivos.'); }
  catch (existing) { if (existing?.code !== 'ENOENT') throw existing; }
}
await mkdir(target);
// This marker contains no personal data and is harmless if uploaded with source.
await writeFile(join(target, markerName), markerText);
for (const { path, absolute } of sources) {
  const destination = join(target, path);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(absolute, destination);
}
console.log(`Pasta pronta: ${target}`);
console.log(`${sources.length} arquivos de codigo e documentacao. Sem dist, node_modules, backups ou bancos.`);
console.log('Envie o CONTEUDO dessa pasta na raiz do repositorio.');
console.log('Crie .github/workflows/pages.yml separadamente, conforme docs/github-pages.md.');

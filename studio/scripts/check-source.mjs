// Check the actual entry-point graph before starting Vite or compiling a desktop
// package. A partial source extraction must not look like a native app crash.
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export function missingSourceFiles(root) {
  const pending = [resolve(root, 'src/main.tsx')];
  const visited = new Set();
  const missing = new Map();
  const variants = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.json', '.css', '/index.ts', '/index.tsx', '/index.js'];
  while (pending.length) {
    const file = pending.pop();
    if (visited.has(file)) continue;
    visited.add(file);
    if (!existsSync(file)) { missing.set(file, { path: relative(root, file), importer: 'application entry point' }); continue; }
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const source = readFileSync(file, 'utf8');
    for (const imported of ts.preProcessFile(source, true, true).importedFiles) {
      if (!imported.fileName.startsWith('.')) continue;
      const target = resolve(dirname(file), imported.fileName.split('?')[0].split('#')[0]);
      const found = variants.map((suffix) => target + suffix).find((candidate) => existsSync(candidate) && statSync(candidate).isFile());
      if (found) pending.push(found);
      else missing.set(target, { path: relative(root, target), importer: relative(root, file) });
    }
  }
  return [...missing.values()];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(process.argv[2] ?? fileURLToPath(new URL('..', import.meta.url)));
  const missing = missingSourceFiles(root);
  if (missing.length) {
    console.error('FPGA Studio cannot start: the source folder is incomplete.');
    for (const file of missing) console.error(`Missing ${file.path} (imported by ${file.importer})`);
    console.error('Stop Studio, then extract a fresh GitHub source ZIP into a NEW folder, or use a fresh Git clone. Keep your project files. Run npm ci inside its studio folder and try again.');
    process.exitCode = 1;
  } else {
    console.log('FPGA Studio source files verified.');
  }
}

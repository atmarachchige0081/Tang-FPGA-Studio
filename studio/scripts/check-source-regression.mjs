import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { missingSourceFiles } from './check-source.mjs';
const folders = [];
function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'Tang Studio source ')); folders.push(root);
  for (const [path, text] of Object.entries(files)) {
    const file = join(root, path); mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, text);
  }
  return root;
}
afterEach(() => folders.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })));
test('accepts a complete graph including CSS, dynamic imports and directory entries', () => {
  const root = fixture({'src/main.tsx':'import "./styles/global.css"; import "./feature"; void import("./lazy.ts");', 'src/styles/global.css':'body {}', 'src/feature/index.tsx':'export const value = 1;', 'src/lazy.ts':'export {};'});
  assert.deepEqual(missingSourceFiles(root), []);
});
test('reports the missing entry point', () => assert.equal(missingSourceFiles(fixture({}))[0].path.replaceAll('\\', '/'), 'src/main.tsx'));
test('detects the reported missing stylesheet and imported state modules', () => {
  const root = fixture({'src/main.tsx':'import "./styles/global.css"; import "./App";', 'src/App.tsx':'import "./store/workbench"; import "./lib/save-file"; import "./lib/workspace-operation";'});
  assert.equal(missingSourceFiles(root).length, 4);
  assert.ok(missingSourceFiles(root).some((file) => file.path.replaceAll('\\', '/') === 'src/store/workbench'));
});
test('aborts startup with recovery instructions instead of launching Vite on missing files', () => {
  const root = fixture({'src/main.tsx':'import "./missing";'});
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./check-source.mjs', import.meta.url)), root], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /source folder is incomplete/);
  assert.match(result.stderr, /fresh GitHub source ZIP/);
});

// xterm 5.5 schedules viewport work that can outlive terminal disposal (including
// React StrictMode's setup/cleanup cycle). Do not access the destroyed renderer.
// Keep this narrow, version-checked workaround until the upstream fix is adopted.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
const root = new URL('../node_modules/@xterm/xterm/', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
if (version !== '5.5.0') throw new Error(`Review the xterm lifecycle workaround for version ${version}.`);
const file = new URL('lib/xterm.js', root);
const original = 'syncScrollArea(e=!1){if(this._lastRecordedBufferLength';
const patched = 'syncScrollArea(e=!1){if(this._isDisposed)return;if(this._lastRecordedBufferLength';
const source = readFileSync(file, 'utf8');
if (source.split(patched).length === 2 && !source.includes(original)) {
  console.log('xterm viewport lifecycle workaround verified.');
} else {
  if (source.split(original).length !== 2) throw new Error('xterm source changed: review the viewport lifecycle workaround before building.');
  rmSync(new URL('../node_modules/.vite', import.meta.url), { recursive: true, force: true });
  writeFileSync(file, source.replace(original, patched));
  console.log('Applied xterm viewport lifecycle workaround.');
}

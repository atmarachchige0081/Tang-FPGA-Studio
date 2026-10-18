// Narrow, version-checked lifecycle fixes for xterm 5.5. The viewport can schedule
// work after disposal; the DPI monitor is not registered for disposal upstream.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
const root = new URL('../node_modules/@xterm/xterm/', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
if (version !== '5.5.0') throw new Error(`Review the xterm lifecycle workaround for version ${version}.`);
const file = new URL('lib/xterm.js', root);
const source = readFileSync(file, 'utf8');
let patchedSource = source;
for (const [original, patched] of [
  ['syncScrollArea(e=!1){if(this._lastRecordedBufferLength', 'syncScrollArea(e=!1){if(this._isDisposed)return;if(this._lastRecordedBufferLength'],
  ['_screenDprMonitor=new a(this._window),', '_screenDprMonitor=this.register(new a(this._window)),'],
]) {
  if (patchedSource.split(patched).length === 2 && !patchedSource.includes(original)) continue;
  if (patchedSource.split(original).length !== 2) throw new Error('xterm source changed: review the lifecycle workaround before building.');
  patchedSource = patchedSource.replace(original, patched);
}
if (patchedSource === source) {
  console.log('xterm viewport and DPI lifecycle workarounds verified.');
} else {
  rmSync(new URL('../node_modules/.vite', import.meta.url), { recursive: true, force: true });
  writeFileSync(file, patchedSource);
  console.log('Applied xterm viewport and DPI lifecycle workarounds.');
}

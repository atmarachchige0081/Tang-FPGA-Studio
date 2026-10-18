// Monaco 0.56 installs a global hover factory using the most recently created
// editor's child InstantiationService. Closing that editor (including a diff)
// then breaks suggestions in surviving editors. Use the window-lived root
// service instead. Keep this pinned workaround until the upstream fix is adopted.
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const packageRoot = new URL('../node_modules/monaco-editor/', import.meta.url);
const { version } = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8'));
if (version !== '0.56.0') throw new Error(`Review the Monaco lifecycle workaround for version ${version}.`);
const file = fileURLToPath(new URL('esm/vs/editor/standalone/browser/standaloneCodeEditor.js', packageRoot));
const originalImport = 'import { StandaloneKeybindingService, updateConfigurationService }';
const patchedImport = 'import { StandaloneServices, StandaloneKeybindingService, updateConfigurationService }';
const originalFactory = 'setHoverDelegateFactory((placement, enableInstantHover) => instantiationService.createInstance(WorkbenchHoverDelegate, placement, { instantHover: enableInstantHover }, {}));';
const patchedFactory = 'setHoverDelegateFactory((placement, enableInstantHover) => StandaloneServices.get(IInstantiationService).createInstance(WorkbenchHoverDelegate, placement, { instantHover: enableInstantHover }, {}));';
const source = readFileSync(file, 'utf8');
if (source.includes(patchedImport) && source.includes(patchedFactory) && !source.includes(originalFactory)) {
  console.log('Monaco hover lifecycle workaround verified.');
} else {
  if (source.split(originalImport).length !== 2 || source.split(originalFactory).length !== 2) {
    throw new Error('Monaco source changed: review the hover lifecycle workaround before building.');
  }
  // Vite caches optimized dependencies independently of their source files.
  // Clear only its generated cache when applying the patch for the first time.
  rmSync(new URL('../node_modules/.vite', import.meta.url), { recursive: true, force: true });
  writeFileSync(file, source.replace(originalImport, patchedImport).replace(originalFactory, patchedFactory));
  console.log('Applied Monaco hover lifecycle workaround.');
}

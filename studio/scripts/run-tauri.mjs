import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareWorkspace } from './stage-linux-workspace.mjs';

const mode = process.argv[2] ?? 'dev';
if (!['dev', 'build', 'check'].includes(mode)) throw new Error(`Unknown desktop mode: ${mode}`);
const studio = fileURLToPath(new URL('..', import.meta.url));
// Preserve Windows' Cargo discovery and MSVC guidance.
if (process.platform === 'win32') {
  const result = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/run-tauri.ps1', mode], { cwd: studio, stdio: 'inherit' });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
if (process.platform !== 'linux') throw new Error('Supported desktop platforms: Windows and Ubuntu Linux.');
// linuxdeploy's AppImage helpers must also work in CI without /dev/fuse.
process.env.APPIMAGE_EXTRACT_AND_RUN ??= '1';
function run(command, args) {
  const result = spawnSync(command, args, { cwd: studio, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('cargo', ['metadata', '--manifest-path', 'src-tauri/Cargo.toml', '--locked', '--no-deps', '--format-version', '1']);
run('pwsh', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']);
run('pkg-config', ['--atleast-version=2.40', 'webkit2gtk-4.1']);
if (mode === 'check') process.exit(0);
prepareWorkspace();
run(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', mode, '--config', 'src-tauri/tauri.linux.conf.json', ...process.argv.slice(3)]);
if (mode === 'build') run(process.execPath, ['scripts/finalize-linux-appimage.mjs']);

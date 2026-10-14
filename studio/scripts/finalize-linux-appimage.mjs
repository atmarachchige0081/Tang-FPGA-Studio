import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// WebKitGTK loads host graphics/GIO modules. Shipping an older GLib beside
// those modules breaks newer Ubuntu releases. Use the host desktop stack,
// just like the .deb; bundle the application and its resources only.
const studio = fileURLToPath(new URL('..', import.meta.url));
const target = process.env.CARGO_TARGET_DIR ?? path.join(studio, 'src-tauri/target');
const directory = path.resolve(studio, target, 'release/bundle/appimage');
const appdir = path.join(directory, 'Tang FPGA Studio.AppDir');
if (!existsSync(appdir)) process.exit(0);
const libraries = path.join(appdir, 'usr/lib');
for (const entry of readdirSync(libraries)) {
  if (entry !== 'Tang FPGA Studio') rmSync(path.join(libraries, entry), { recursive: true, force: true });
}
writeFileSync(path.join(appdir, 'AppRun'), '#!/bin/sh\nset -eu\nappdir=${APPDIR:-$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)}\nexec "$appdir/usr/bin/fpga-studio" "$@"\n', { mode: 0o755 });
function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
run('patchelf', ['--remove-rpath', path.join(appdir, 'usr/bin/fpga-studio')]);
const cache = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache');
const packer = path.join(cache, 'tauri/linuxdeploy-plugin-appimage.AppImage');
const image = readdirSync(directory).find((entry) => entry.endsWith('.AppImage'));
if (!image) throw new Error('Tauri did not produce an AppImage to finalize');
run(packer, ['--appdir', appdir], { ...process.env, APPIMAGE_EXTRACT_AND_RUN: '1', ARCH: 'x86_64', OUTPUT: path.join(directory, image) });

import { chmodSync, cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export function prepareWorkspace() {
  const repository = fileURLToPath(new URL('../..', import.meta.url));
  const destination = path.join(repository, 'studio/src-tauri/resources/workspace');
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  const omitted = new Set(['build', '__pycache__', '.fpga-studio', 'obj_dir', '.git']);
  for (const entry of ['fpga.ps1', 'fpga.config.psd1', 'rtl', 'sim', 'constraints', 'scripts', 'projects', 'templates', 'boards', 'ip', 'plugins', 'ide', 'docs', 'LICENSE']) {
    cpSync(path.join(repository, entry), path.join(destination, entry), {
      recursive: true,
      filter: (source) => !omitted.has(path.basename(source)) && !source.endsWith('.pyc'),
    });
  }
  function permissions(directory) {
    chmodSync(directory, 0o755);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) permissions(target);
      else if (entry.isFile()) chmodSync(target, entry.name.endsWith('.sh') ? 0o755 : 0o644);
      else throw new Error(`Unsupported packaged resource: ${target}`);
    }
  }
  permissions(destination);
}

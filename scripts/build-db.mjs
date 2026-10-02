import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const venv = join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = existsSync(venv) ? venv : (process.platform === 'win32' ? 'python' : 'python3');
const result = spawnSync(python, [join(root, 'scripts/build_dictionary.py'), ...process.argv.slice(2)], {
  cwd: root,
  stdio: 'inherit'
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);

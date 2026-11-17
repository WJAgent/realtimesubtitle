// Runs every CI check, keeps going after a failure, and prints a summary.
// This mirrors .github/workflows/ci.yml, so `npm run ci` locally == what CI runs.
import { spawnSync } from 'node:child_process';

const steps = [
  ['lint', ['npm', 'run', '--silent', 'lint']],
  ['test', ['npm', 'test', '--silent']],
  ['secrets', ['npm', 'run', '--silent', 'check:secrets']],
];

const results = [];
for (const [name, cmd] of steps) {
  console.log(`\n=== ${name}: ${cmd.join(' ')} ===`);
  const r = spawnSync(cmd[0], cmd.slice(1), { stdio: 'inherit', shell: process.platform === 'win32' });
  results.push([name, r.status === 0]);
}

console.log('\n=== CI summary ===');
for (const [name, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);

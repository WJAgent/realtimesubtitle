// Fails if something that looks like a Google API key is committed.
// API keys are typed into the operator console at runtime and must never live in the repo.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const PATTERN = /AIza[0-9A-Za-z_-]{35}/;
const SKIP = new Set(['node_modules', '.git']);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

const hits = [];
for (const file of walk('.')) {
  if (file.endsWith('package-lock.json')) continue;
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (PATTERN.test(line)) hits.push(`${file}:${i + 1}`);
  });
}

if (hits.length) {
  console.error('Possible API key committed at:\n  ' + hits.join('\n  '));
  process.exit(1);
}
console.log('No API keys found.');

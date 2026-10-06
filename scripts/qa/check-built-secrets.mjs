import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../../dist/', import.meta.url));
const forbidden = [
  ['Supabase secret key', /(?:service_role|sb_secret_)[A-Za-z0-9._-]{12,}/],
  ['private key', /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/],
  ['legacy Calendar ID', /[a-f0-9]{40,}@group\.calendar\.google\.com/i],
  ['legacy quiz answer text', /Material type, thickness, focus, ventilation, and file setup|Printer bed condition, filament, and sliced file/],
  ['test-only mock backend', /Unknown mock admin operation|Synthetic E2E quiz bank/],
];

async function files(directory) {
  const output = [];
  for (const name of await readdir(directory)) {
    const path = join(directory, name);
    if ((await stat(path)).isDirectory()) output.push(...await files(path));
    else output.push(path);
  }
  return output;
}

const failures = [];
for (const path of await files(root)) {
  const content = await readFile(path, 'utf8').catch(() => '');
  for (const [label, pattern] of forbidden) if (pattern.test(content)) failures.push(`${label}: ${relative(root, path)}`);
}
if (failures.length) {
  process.stderr.write(`Production bundle secret check failed:\n${failures.join('\n')}\n`);
  process.exit(1);
}
process.stdout.write('Production bundle contains no configured secrets, private answer text, Calendar IDs, or test backend.\n');

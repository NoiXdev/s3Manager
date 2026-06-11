import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { init } from 'license-checker-rseidelsohn';
import { transform } from './licenses-transform.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outFile = join(root, 'src/renderer/components/settings/licenses.generated.json');

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

init({ start: root, direct: false, excludePackages: `${pkg.name}@${pkg.version}` }, (err, packages) => {
  if (err) {
    console.error('license generation failed:', err);
    process.exit(1);
  }
  const entries = transform(packages);
  writeFileSync(outFile, JSON.stringify(entries, null, 2) + '\n');
  console.log(`Wrote ${entries.length} license entries to ${outFile}`);
});

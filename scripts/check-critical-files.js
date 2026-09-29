/**
 * Fails CI/local if critical modules are empty or missing required exports.
 * Run: npm run check:critical
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

const MIN_BYTES = {
  'src/modules/assessment/assessment.service.js': 10_000,
  'src/modules/reports/reports.service.js': 5_000,
  'src/config/redis.js': 200,
};

for (const [rel, minBytes] of Object.entries(MIN_BYTES)) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) {
    errors.push(`Missing file: ${rel}`);
    continue;
  }
  const size = fs.statSync(abs).size;
  if (size < minBytes) {
    errors.push(`${rel} is only ${size} bytes (expected >= ${minBytes}). Likely wiped or empty.`);
  }
}

try {
  const redisUrl = pathToFileURL(path.join(root, 'src/config/redis.js')).href;
  const redis = await import(redisUrl);
  for (const name of ['getRedis', 'redisEnabled']) {
    if (typeof redis[name] !== 'function') {
      errors.push(`src/config/redis.js must export function ${name}`);
    }
  }
} catch (err) {
  errors.push(`Failed to import src/config/redis.js: ${err.message}`);
}

if (errors.length) {
  console.error('check:critical failed:\n' + errors.map((e) => ` - ${e}`).join('\n'));
  process.exit(1);
}

console.log('check:critical ok');

import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const pairs = [
  [
    'irads-backend/ml/models/irads_model.tflite',
    'assets/models/irads_model.tflite',
  ],
  [
    'irads-backend/ml/models/normalization.json',
    'assets/models/normalization.json',
  ],
];

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(
      `Invalid ${label}: ${error instanceof Error ? error.message : error}`,
    );
  }
}

function assertNormalizationMatches(sourcePath, bundledPath) {
  const source = readJson(sourcePath, 'source normalization JSON');
  const bundled = readJson(bundledPath, 'bundled normalization JSON');

  for (const field of ['features', 'mean', 'std']) {
    if (JSON.stringify(source[field]) !== JSON.stringify(bundled[field])) {
      throw new Error(
        `Bundled normalization values are stale: ${field} differs from the backend source.`,
      );
    }
  }
}

for (const [sourceRelative, bundledRelative] of pairs) {
  const source = resolve(root, sourceRelative);
  const bundled = resolve(root, bundledRelative);

  try {
    statSync(source);
    statSync(bundled);
  } catch (error) {
    throw new Error(
      `Missing model asset: ${error instanceof Error ? error.message : error}`,
    );
  }

  if (digest(source) !== digest(bundled)) {
    throw new Error(
      `Bundled asset is stale: ${bundledRelative} does not match ${sourceRelative}`,
    );
  }

  if (sourceRelative.endsWith('normalization.json')) {
    assertNormalizationMatches(source, bundled);
  }
}

console.log('Model and normalization assets are present and synchronized.');

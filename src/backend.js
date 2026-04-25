import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function resolveBackendBase() {
  const candidates = [
    path.resolve(__dirname, '../../../backend/src'),
    path.resolve(__dirname, '../../../backend/dist'),
    path.resolve(__dirname, '../../../../backend/src'),
    path.resolve(__dirname, '../../../../backend/dist'),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(
    `[Leonarr] Cannot locate Oscarr backend. Checked: ${candidates.join(', ')}`
  );
}

const BACKEND_BASE = resolveBackendBase();
const cache = new Map();
export function load(relPath) {
  if (!cache.has(relPath)) {
    const full = path.join(BACKEND_BASE, relPath);
    cache.set(relPath, import(full));
  }
  return cache.get(relPath);
}

export const BACKEND_PATH = BACKEND_BASE;

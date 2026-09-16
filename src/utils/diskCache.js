import { mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Small on-disk cache for feeds that are large and change at most daily.
 *
 * Resolved against the repo rather than the working directory so the cache is
 * shared no matter where the tool is run from.
 */
const CACHE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../.cache');

function pathFor(key) {
  return join(CACHE_DIR, `${key}.json`);
}

/**
 * Read a cached value, or null when it is missing, stale or unreadable.
 * A bad cache is never fatal - the caller just refetches.
 */
export function readCache(key, maxAgeHours) {
  try {
    const file = pathFor(key);
    const ageHours = (Date.now() - statSync(file).mtimeMs) / 3_600_000;
    if (ageHours > maxAgeHours) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Write a value to the cache. Failures are ignored - the cache is an optimisation. */
export function writeCache(key, value) {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(pathFor(key), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

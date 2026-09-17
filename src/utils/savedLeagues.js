import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Remembered leagues, so repeat runs do not re-ask for the same details.
 *
 * Stored beside the project in a gitignored config file. ESPN private leagues
 * need cookies to read at all, so those are kept here too - treat the file as
 * you would any other local credential store.
 */
const CONFIG_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../../config.json');

function emptyConfig() {
  return { leagues: [] };
}

export function loadConfig() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
    return { ...emptyConfig(), ...config, leagues: config.leagues || [] };
  } catch {
    return emptyConfig();
  }
}

function saveConfig(config) {
  try {
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
    return true;
  } catch {
    return false;
  }
}

export function getSavedLeagues() {
  return loadConfig().leagues;
}

/** Same league and account already remembered? */
function sameEntry(a, b) {
  return a.platform === b.platform &&
    (a.leagueId || null) === (b.leagueId || null) &&
    (a.username || null) === (b.username || null);
}

/**
 * Remember a league. Returns true when something new was stored, false when it
 * was already known (in which case its details are refreshed).
 */
export function rememberLeague(entry) {
  if (!entry?.platform) return false;

  const config = loadConfig();

  // An account saved before a league was chosen is a placeholder; once a real
  // league is known it takes that slot rather than sitting beside it.
  if (entry.leagueId) {
    const placeholder = config.leagues.findIndex(saved =>
      saved.platform === entry.platform &&
      !saved.leagueId &&
      (saved.username || null) === (entry.username || null)
    );
    if (placeholder !== -1) config.leagues.splice(placeholder, 1);
  }

  const existing = config.leagues.find(saved => sameEntry(saved, entry));

  if (existing) {
    Object.assign(existing, entry, { lastUsed: new Date().toISOString() });
    saveConfig(config);
    return false;
  }

  config.leagues.push({ ...entry, lastUsed: new Date().toISOString() });
  saveConfig(config);
  return true;
}

export function forgetLeague(index) {
  const config = loadConfig();
  if (index < 0 || index >= config.leagues.length) return false;
  config.leagues.splice(index, 1);
  return saveConfig(config);
}

/** One-line description for the picker. */
export function describeLeague(entry) {
  const platform = entry.platform.toUpperCase();
  const who = entry.username ? ` - ${entry.username}` : '';
  const name = entry.name || entry.leagueId || 'league';
  return `${name} (${platform}${who})`;
}

export { CONFIG_PATH };

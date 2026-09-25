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

/**
 * Players you are tracking in a league, stored per league so two leagues do not
 * share a list. Each entry keeps the last value seen, which is what lets the
 * report show whether a player is rising or fading since you last looked.
 */
export function getWatchlist(leagueId) {
  const config = loadConfig();
  return config.watchlists?.[leagueId] || [];
}

export function watchPlayer(leagueId, entry) {
  const config = loadConfig();
  config.watchlists ||= {};
  const list = (config.watchlists[leagueId] ||= []);

  const existing = list.find(item => item.playerId === entry.playerId);
  if (existing) {
    Object.assign(existing, entry);
    saveConfig(config);
    return false;
  }

  list.push({ ...entry, addedAt: new Date().toISOString() });
  saveConfig(config);
  return true;
}

export function unwatchPlayer(leagueId, playerId) {
  const config = loadConfig();
  const list = config.watchlists?.[leagueId];
  if (!list) return false;

  const index = list.findIndex(item => item.playerId === playerId);
  if (index === -1) return false;

  list.splice(index, 1);
  saveConfig(config);
  return true;
}

/** Record what each watched player was worth, so movement can be shown later. */
export function recordWatchValues(leagueId, values) {
  const config = loadConfig();
  const list = config.watchlists?.[leagueId];
  if (!list) return;

  for (const item of list) {
    const seen = values[item.playerId];
    if (seen === undefined) continue;
    item.lastGain = seen;
    item.lastSeen = new Date().toISOString();
  }

  saveConfig(config);
}

export { CONFIG_PATH };

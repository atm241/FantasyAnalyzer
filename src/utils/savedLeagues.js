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

/**
 * The ESPN team remembered for a league, so later runs skip the team prompt.
 *
 * ESPN has no username to log in with, so the team is the identity. It is kept
 * by owner id, which survives the team being renamed; the name is only for
 * display.
 */
export function getSavedEspnTeam(leagueId) {
  if (!leagueId) return null;
  const entry = loadConfig().leagues.find(saved =>
    saved.platform === 'espn' && String(saved.leagueId) === String(leagueId) && saved.teamOwnerId
  );
  return entry ? { ownerId: entry.teamOwnerId, teamName: entry.teamName || null } : null;
}

/**
 * Remember which team is yours in an ESPN league. Returns true when this
 * changed what was stored.
 */
export function rememberEspnTeam(leagueId, ownerId, teamName) {
  if (!leagueId || !ownerId) return false;

  const config = loadConfig();
  const entries = config.leagues.filter(saved =>
    saved.platform === 'espn' && String(saved.leagueId) === String(leagueId)
  );
  if (entries.length === 0) return false;

  const changed = entries.some(entry =>
    entry.teamOwnerId !== ownerId || entry.teamName !== teamName
  );
  if (!changed) return false;

  for (const entry of entries) Object.assign(entry, { teamOwnerId: ownerId, teamName });
  return saveConfig(config);
}

/**
 * Find your team among an ESPN league's users.
 *
 * In order: a team whose name matches what you typed exactly, the team saved
 * from a previous run, then a team or owner name containing what you typed.
 * An empty name never matches by text, since every name contains ''.
 */
export function matchEspnTeam(users = [], { name, savedOwnerId } = {}) {
  const typed = (name || '').trim().toLowerCase();
  const teamName = user => (user.metadata?.team_name || '').toLowerCase();

  if (typed) {
    const exact = users.find(user => teamName(user) === typed);
    if (exact) return exact;
  }

  if (savedOwnerId) {
    const saved = users.find(user => user.user_id === savedOwnerId);
    if (saved) return saved;
  }

  if (!typed) return null;
  return users.find(user =>
    teamName(user).includes(typed) ||
    (user.display_name || '').toLowerCase().includes(typed)
  ) || null;
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
  const owner = entry.username || entry.teamName;
  const who = owner ? ` - ${owner}` : '';
  const name = entry.name || entry.leagueId || 'league';
  return `${name} (${platform}${who})`;
}

/**
 * Find this season's continuation of a league from an earlier season.
 *
 * Sleeper gives a renewed league a new id every year, so a saved id goes stale
 * when a season rolls over. A renewal links back through previous_league_id;
 * failing that, a league with the very same name is taken only when there is
 * exactly one, so a guess never picks between two candidates.
 */
export function findRenewedLeague(oldLeague, leagues = []) {
  const linked = leagues.find(l => l.previous_league_id === oldLeague.league_id);
  if (linked) return linked;

  const sameName = leagues.filter(l => l.name === oldLeague.name);
  return sameName.length === 1 ? sameName[0] : null;
}

/**
 * Point a saved league at its renewed id. The watchlist moves with it, since
 * the players being tracked carry over between seasons.
 */
export function moveLeague(platform, oldId, renewed) {
  const config = loadConfig();
  const entry = config.leagues.find(saved =>
    saved.platform === platform && saved.leagueId === oldId
  );
  if (entry) {
    Object.assign(entry, {
      leagueId: renewed.league_id,
      name: renewed.name,
      season: renewed.season || null
    });
  }

  if (config.watchlists?.[oldId]) {
    config.watchlists[renewed.league_id] ||= config.watchlists[oldId];
    delete config.watchlists[oldId];
  }

  return saveConfig(config);
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

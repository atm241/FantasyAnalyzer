import axios from 'axios';
import { getCurrentSeasonYear } from './nflSchedule.js';

/**
 * Offensive tiers, derived at runtime from actual points scored.
 *
 * These used to be a hand-written list that silently rotted: by the end of the
 * 2025 season it still boosted KC (21st in scoring) and penalised New England
 * (2nd). Ranking real scoring output keeps the tiers honest season to season.
 */

const STANDINGS_URL = 'https://site.api.espn.com/apis/v2/sports/football/nfl/standings';

/** Tier sizes, kept at the sizes the multipliers were originally calibrated for. */
const ELITE_COUNT = 8;
const WEAK_COUNT = 7;

/**
 * Below this many teams the two tiers would overlap and a team could count as
 * both elite and weak, so a partial feed is treated as no data at all.
 */
const MIN_TEAMS = ELITE_COUNT + WEAK_COUNT + 1;

/**
 * Games the average team must have played before the current season's scoring
 * is a better signal than last season's full body of work.
 */
const MIN_GAMES_FOR_CURRENT_SEASON = 4;

/** ESPN uses WSH; the rest of the app uses Sleeper's abbreviations. */
const ABBREVIATION_FIXES = { WSH: 'WAS' };

export const TEAM_MULTIPLIERS = {
  ELITE: 1.15,
  WEAK: 0.85
};

let active = null;
let loading = null;
let warned = false;

function normalizeTeam(abbreviation) {
  return ABBREVIATION_FIXES[abbreviation] || abbreviation;
}

/** Pull every team's points scored and games played out of a standings payload. */
function extractTeams(payload) {
  const teams = [];

  const walk = node => {
    for (const entry of node?.standings?.entries || []) {
      const abbreviation = entry.team?.abbreviation;
      if (!abbreviation) continue;

      const stat = name => entry.stats?.find(s => s.name === name)?.value ?? 0;
      const games = stat('wins') + stat('losses') + stat('ties');
      if (games <= 0) continue;

      teams.push({
        team: normalizeTeam(abbreviation),
        pointsPerGame: stat('pointsFor') / games,
        games
      });
    }
    for (const child of node?.children || []) walk(child);
  };

  walk(payload);
  return teams;
}

async function fetchSeason(season) {
  const { data } = await axios.get(STANDINGS_URL, {
    params: { season },
    timeout: 10000
  });
  return extractTeams(data);
}

function buildTiers(teams, season) {
  if (teams.length < MIN_TEAMS) return null;

  const ranked = [...teams].sort((a, b) => b.pointsPerGame - a.pointsPerGame);
  return {
    season,
    elite: new Set(ranked.slice(0, ELITE_COUNT).map(t => t.team)),
    weak: new Set(ranked.slice(-WEAK_COUNT).map(t => t.team)),
    ranked
  };
}

const EMPTY_TIERS = { season: null, elite: new Set(), weak: new Set(), ranked: [] };

/**
 * Load (and cache) the offensive tiers. Prefers the current season once enough
 * games have been played, otherwise falls back to last season's finished data.
 *
 * Never throws: if scoring data is unavailable every team is treated as average
 * (multiplier 1.0), which is the neutral, least-wrong assumption.
 */
export async function loadTeamRankings(season = getCurrentSeasonYear()) {
  if (active) return active;
  if (loading) return loading;

  loading = (async () => {
    const year = Number(season);
    let reason = 'no usable scoring data';

    try {
      const current = await fetchSeason(year);
      const averageGames = current.length > 0
        ? current.reduce((sum, t) => sum + t.games, 0) / current.length
        : 0;

      // Early in a season last year's finished data is the better signal.
      if (averageGames >= MIN_GAMES_FOR_CURRENT_SEASON) {
        active = buildTiers(current, year);
      }

      if (!active) {
        // Prefer last season, but never at the cost of discarding usable
        // current-season numbers if that second request fails.
        let previous = null;
        try {
          previous = buildTiers(await fetchSeason(year - 1), year - 1);
        } catch {
          previous = null;
        }
        active = previous || buildTiers(current, year);
      }
    } catch (error) {
      active = null;
      reason = error.message;
    }

    if (!active) {
      active = EMPTY_TIERS;
      if (!warned) {
        warned = true;
        console.warn(
          `⚠️  Could not load NFL scoring data (${reason}). ` +
          'Every team will be projected as average.'
        );
      }
    }
    return active;
  })();

  return loading;
}

/** The season the active tiers were derived from, or null if unavailable. */
export function getRankingsSeason() {
  return active?.season ?? null;
}

export function getRankedOffenses() {
  return active?.ranked ?? [];
}

export function isEliteOffense(team) {
  return Boolean(team) && Boolean(active?.elite.has(team));
}

export function isWeakOffense(team) {
  return Boolean(team) && Boolean(active?.weak.has(team));
}

/**
 * Get team quality multiplier for projections
 */
export function getTeamMultiplier(team) {
  if (isEliteOffense(team)) return TEAM_MULTIPLIERS.ELITE;
  if (isWeakOffense(team)) return TEAM_MULTIPLIERS.WEAK;
  return 1.0; // Average team
}

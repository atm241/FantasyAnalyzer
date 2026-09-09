import { getCurrentSeasonYear } from './season.js';

/**
 * NFL Bye Week Schedules, keyed by season year.
 *
 * This table is a FALLBACK only. Prefer the bye week reported by the platform
 * API for a given player (Sleeper exposes `bye_week` on its player records),
 * because that is always current. The table is used when the API does not
 * supply one.
 *
 * When a season is missing here the helpers below report "unknown" rather than
 * falling back to another year's schedule -- a stale schedule silently benches
 * healthy players and starts players who are actually on bye.
 */
export const BYE_WEEKS_BY_SEASON = {
  // Source: ESPN (https://www.espn.com/nfl/story/_/id/45944807/nfl-bye-weeks-every-team-2025)
  2025: {
    // Week 5
    'ATL': 5,
    'CHI': 5,
    'GB': 5,
    'PIT': 5,

    // Week 6
    'HOU': 6,
    'MIN': 6,

    // Week 7
    'BAL': 7,
    'BUF': 7,

    // Week 8
    'ARI': 8,
    'DET': 8,
    'JAX': 8,
    'LV': 8,
    'LAR': 8,
    'SEA': 8,

    // Week 9
    'CLE': 9,
    'NYJ': 9,
    'PHI': 9,
    'TB': 9,

    // Week 10
    'CIN': 10,
    'DAL': 10,
    'KC': 10,
    'TEN': 10,

    // Week 11
    'IND': 11,
    'NO': 11,

    // Week 12
    'DEN': 12,
    'LAC': 12,
    'MIA': 12,
    'WAS': 12,

    // Week 13 (no byes)

    // Week 14
    'CAR': 14,
    'NE': 14,
    'NYG': 14,
    'SF': 14
  }
};

const warnedSeasons = new Set();

/**
 * Bye week table for a season, or null when we have no data for it.
 */
export function getSeasonByeWeeks(season) {
  const table = BYE_WEEKS_BY_SEASON[Number(season)];
  if (!table && !warnedSeasons.has(Number(season))) {
    warnedSeasons.add(Number(season));
    console.warn(
      `Warning: no bye week schedule on file for the ${season} season. ` +
      `Bye weeks will only be shown for players whose bye the platform API reports. ` +
      `Add the ${season} schedule to src/data/byeWeeks.js for full coverage.`
    );
  }
  return table || null;
}

/**
 * Check if a team is on bye for a given week.
 */
export function isOnBye(team, week, season = getCurrentSeasonYear()) {
  if (!team || !week) return false;
  const byeWeek = getByeWeek(team, season);
  return byeWeek === week;
}

/**
 * Get bye week for a team, or null when unknown.
 */
export function getByeWeek(team, season = getCurrentSeasonYear()) {
  if (!team) return null;
  const table = getSeasonByeWeeks(season);
  return table?.[team] ?? null;
}

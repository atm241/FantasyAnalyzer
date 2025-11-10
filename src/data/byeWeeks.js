/**
 * 2025 NFL Bye Week Schedule
 * Maps team abbreviations to their bye week number
 * Source: ESPN (https://www.espn.com/nfl/story/_/id/45944807/nfl-bye-weeks-every-team-2025)
 */
export const BYE_WEEKS_2025 = {
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
};

/**
 * Check if a team is on bye for a given week
 */
export function isOnBye(team, week) {
  if (!team || !week) return false;
  return BYE_WEEKS_2025[team] === week;
}

/**
 * Get bye week for a team
 */
export function getByeWeek(team) {
  if (!team) return null;
  return BYE_WEEKS_2025[team] || null;
}

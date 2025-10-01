/**
 * 2025 NFL Bye Week Schedule
 * Maps team abbreviations to their bye week number
 */
export const BYE_WEEKS_2025 = {
  // Week 5
  'ATL': 5,
  'CHI': 5,
  'GB': 5,
  'PIT': 5,

  // Week 6
  'LAC': 6,
  'TB': 6,

  // Week 7
  'HOU': 7,
  'TEN': 7,

  // Week 8
  'CLE': 8,
  'DEN': 8,
  'IND': 8,
  'JAX': 8,
  'NO': 8,
  'WAS': 8,

  // Week 9
  'DAL': 9,
  'DET': 9,
  'KC': 9,
  'LAR': 9,

  // Week 10
  'ARI': 10,
  'BAL': 10,
  'BUF': 10,
  'CIN': 10,
  'LV': 10,
  'MIA': 10,
  'MIN': 10,
  'SEA': 10,

  // Week 11
  'NYJ': 11,
  'PHI': 11,

  // Week 12
  'None': 12, // No teams on bye

  // Week 13 (no byes)

  // Week 14
  'NE': 14,
  'NYG': 14,
  'CAR': 14,
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

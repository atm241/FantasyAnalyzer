/**
 * NFL Team Rankings and Classifications
 * Updated for 2025 season
 */

/**
 * Elite offensive teams - higher scoring expectations
 */
export const ELITE_OFFENSES = [
  'KC',  // Kansas City Chiefs
  'SF',  // San Francisco 49ers
  'BAL', // Baltimore Ravens
  'BUF', // Buffalo Bills
  'MIA', // Miami Dolphins
  'DAL', // Dallas Cowboys
  'PHI', // Philadelphia Eagles
  'DET'  // Detroit Lions
];

/**
 * Weak offensive teams - lower scoring expectations
 */
export const WEAK_OFFENSES = [
  'CAR', // Carolina Panthers
  'NE',  // New England Patriots
  'TEN', // Tennessee Titans
  'NYG', // New York Giants
  'LV',  // Las Vegas Raiders
  'JAX', // Jacksonville Jaguars
  'CHI'  // Chicago Bears
];

/**
 * Team quality multipliers for projections
 */
export const TEAM_MULTIPLIERS = {
  ELITE: 1.15,
  WEAK: 0.85
};

/**
 * Check if a team has an elite offense
 */
export function isEliteOffense(team) {
  return ELITE_OFFENSES.includes(team);
}

/**
 * Check if a team has a weak offense
 */
export function isWeakOffense(team) {
  return WEAK_OFFENSES.includes(team);
}

/**
 * Get team quality multiplier for projections
 */
export function getTeamMultiplier(team) {
  if (isEliteOffense(team)) return TEAM_MULTIPLIERS.ELITE;
  if (isWeakOffense(team)) return TEAM_MULTIPLIERS.WEAK;
  return 1.0; // Average team
}

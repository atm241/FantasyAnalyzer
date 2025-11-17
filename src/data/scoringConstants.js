/**
 * Fantasy Football Scoring and Position Constants
 */

/**
 * Base points per game by position
 * Used for projection estimation when no specific data available
 */
export const BASE_POINTS = {
  QB: 18,
  RB: 12,
  WR: 11,
  TE: 9,
  K: 8,
  DEF: 8
};

/**
 * Position scarcity multipliers
 * Reflects relative value due to position scarcity in fantasy
 */
export const POSITION_SCARCITY = {
  QB: 1.0,
  RB: 1.3,  // RBs are most scarce
  WR: 1.1,
  TE: 1.2,  // TEs are scarce but lower volume
  K: 0.3,   // Kickers have low value
  DEF: 0.3  // Defenses have low value
};

/**
 * Position value for waiver wire scoring
 * Higher numbers = higher priority on waivers
 */
export const POSITION_VALUE = {
  QB: 10,
  RB: 15,  // Highest value
  WR: 12,
  TE: 8,
  K: 2,    // Lowest value
  DEF: 5
};

/**
 * Position value for drop/trade analysis
 * Reflects importance in roster construction
 */
export const ROSTER_POSITION_VALUE = {
  QB: 15,
  RB: 20,
  WR: 15,
  TE: 18,
  K: 5,
  DEF: 5
};

/**
 * Injury status multipliers for projections
 * Multiply projected points by these values based on injury status
 */
export const INJURY_MULTIPLIERS = {
  IR: 0,
  Out: 0,
  Doubtful: 0.2,
  Questionable: 0.7,
  Active: 1.0
};

/**
 * Season configuration
 */
export const SEASON_CONFIG = {
  CURRENT_YEAR: 2025,
  SEASON_START_DATE: '2025-09-04', // Thursday, Sept 4, 2025
  EARLY_SEASON_END_WEEK: 8,
  PLAYOFF_PUSH_START_WEEK: 14,
  REGULAR_SEASON_WEEKS: 14,
  PLAYOFF_WEEKS: 4
};

/**
 * Get injury multiplier for a given injury status
 */
export function getInjuryMultiplier(injuryStatus) {
  return INJURY_MULTIPLIERS[injuryStatus] ?? INJURY_MULTIPLIERS.Active;
}

/**
 * Check if injury status indicates player is unavailable
 */
export function isPlayerUnavailable(injuryStatus) {
  return injuryStatus === 'IR' || injuryStatus === 'Out';
}

/**
 * Check if injury status indicates player is seriously questionable
 */
export function isPlayerLikelyOut(injuryStatus) {
  return ['IR', 'Out', 'Doubtful'].includes(injuryStatus);
}

/**
 * Get base points for a position
 */
export function getBasePoints(position) {
  return BASE_POINTS[position] ?? 0;
}

/**
 * Get position scarcity multiplier
 */
export function getPositionScarcity(position) {
  return POSITION_SCARCITY[position] ?? 1.0;
}

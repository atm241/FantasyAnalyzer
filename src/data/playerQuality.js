/**
 * Player quality derived from Sleeper's own signals.
 *
 * These replace the hand-maintained name lists the projections used to depend
 * on, which hardcoded roughly eighty players and went stale every season.
 */

/**
 * Sleeper's search_rank orders every player by fantasy relevance (1 is the most
 * relevant). Unranked players fall through as replacement level.
 */
export function rankMultiplier(searchRank) {
  if (searchRank == null || searchRank >= 9999999) return 0.75;
  if (searchRank <= 25) return 1.40;
  if (searchRank <= 60) return 1.25;
  if (searchRank <= 120) return 1.10;
  if (searchRank <= 200) return 1.00;
  if (searchRank <= 350) return 0.85;
  return 0.75;
}

/**
 * Depth chart position. A backup scores far less than the starter ahead of
 * them, which is what the old "backup RB" name list was approximating.
 */
export function depthMultiplier(depthChartOrder, position) {
  if (depthChartOrder == null) return 1.0;
  if (!['RB', 'WR', 'TE', 'QB'].includes(position)) return 1.0;
  if (depthChartOrder <= 1) return 1.0;
  if (depthChartOrder === 2) return position === 'QB' ? 0.25 : 0.80;
  return position === 'QB' ? 0.15 : 0.65;
}

/** Combined quality multiplier for a player, before any team adjustment. */
export function playerQuality(player) {
  return rankMultiplier(player?.searchRank) *
    depthMultiplier(player?.depthChartOrder, player?.position);
}

/**
 * Lineup optimizer using projections and scoring rules
 */
export class LineupOptimizer {
  constructor(rosterService) {
    this.rosterService = rosterService;
  }

  /**
   * Simple projection model (can be enhanced with real projections API)
   * For now, uses a basic heuristic based on player status and position
   */
  estimatePoints(player, scoringSettings) {
    // This is a placeholder - in production you'd fetch actual projections
    // from ESPN, FantasyPros, or another source
    const basePoints = {
      'QB': 18,
      'RB': 12,
      'WR': 11,
      'TE': 9,
      'K': 8,
      'DEF': 8
    };

    let points = basePoints[player.position] || 0;

    // Players on BYE get 0 points
    if (player.onBye) {
      return 0;
    }

    // Reduce points for injured/questionable players
    if (player.injuryStatus === 'Out') points = 0;
    if (player.injuryStatus === 'Doubtful') points *= 0.2;
    if (player.injuryStatus === 'Questionable') points *= 0.7;
    if (player.injuryStatus === 'IR') points = 0;

    return points;
  }

  /**
   * Optimize lineup given available players and roster positions
   */
  async optimizeLineup(leagueId, roster) {
    const scoringSettings = await this.rosterService.getScoringSettings(leagueId);
    const rosterPositions = await this.rosterService.getRosterPositions(leagueId);

    // Get all players with projections
    const allPlayers = roster.starters.concat(roster.bench);
    const playersWithProjections = allPlayers.map(player => ({
      ...player,
      projection: this.estimatePoints(player, scoringSettings)
    }));

    // Sort by projection (highest first)
    playersWithProjections.sort((a, b) => b.projection - a.projection);

    // Fill roster positions greedily
    const lineup = [];
    const usedPlayers = new Set();

    for (const position of rosterPositions) {
      if (position === 'BN') continue; // Skip bench slots

      const eligiblePlayers = playersWithProjections.filter(player => {
        if (usedPlayers.has(player.playerId)) return false;

        // Check position eligibility
        if (position === 'FLEX') {
          return ['RB', 'WR', 'TE'].includes(player.position);
        } else if (position === 'SUPER_FLEX') {
          return ['QB', 'RB', 'WR', 'TE'].includes(player.position);
        } else if (position === 'WRRB_FLEX') {
          return ['RB', 'WR'].includes(player.position);
        } else if (position === 'REC_FLEX') {
          return ['WR', 'TE'].includes(player.position);
        } else {
          return player.position === position;
        }
      });

      if (eligiblePlayers.length > 0) {
        const bestPlayer = eligiblePlayers[0];
        lineup.push({ ...bestPlayer, slotPosition: position });
        usedPlayers.add(bestPlayer.playerId);
      } else {
        lineup.push({ slotPosition: position, empty: true });
      }
    }

    // Remaining players go to bench
    const bench = playersWithProjections.filter(p => !usedPlayers.has(p.playerId));

    return {
      lineup,
      bench,
      totalProjectedPoints: lineup.reduce((sum, p) => sum + (p.projection || 0), 0)
    };
  }

  /**
   * Compare current lineup to optimal lineup
   */
  async analyzeLineup(leagueId, currentRoster) {
    const formatted = await this.rosterService.formatRoster(currentRoster);
    const optimal = await this.optimizeLineup(leagueId, formatted);

    // Calculate current lineup points
    const currentPoints = formatted.starters.reduce((sum, player) => {
      return sum + this.estimatePoints(player, {});
    }, 0);

    const recommendations = [];

    // Find lineup improvements
    formatted.starters.forEach((starter, idx) => {
      const optimalPlayer = optimal.lineup[idx];
      if (optimalPlayer && !optimalPlayer.empty &&
          starter.playerId !== optimalPlayer.playerId) {
        recommendations.push({
          type: 'swap',
          out: starter,
          in: optimalPlayer,
          improvement: optimalPlayer.projection - this.estimatePoints(starter, {})
        });
      }
    });

    return {
      currentLineup: formatted.starters,
      optimalLineup: optimal.lineup,
      currentPoints,
      optimalPoints: optimal.totalProjectedPoints,
      pointsGain: optimal.totalProjectedPoints - currentPoints,
      recommendations
    };
  }
}

/**
 * Lineup optimizer using projections and scoring rules
 */
export class LineupOptimizer {
  constructor(rosterService) {
    this.rosterService = rosterService;
  }

  /**
   * Enhanced projection model with player quality tiers
   */
  estimatePoints(player, scoringSettings) {
    // Base points by position
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

    // Apply player quality modifiers based on tier
    points *= this.getPlayerQualityMultiplier(player);

    return points;
  }

  /**
   * Get player quality multiplier based on name/team/situation
   * This helps differentiate between elite, good, mediocre, and bad players
   */
  getPlayerQualityMultiplier(player) {
    const name = player.name?.toLowerCase() || '';
    const team = player.team;
    const position = player.position;

    // Elite tier players (1.3-1.5x multiplier)
    const elitePlayers = [
      'christian mccaffrey', 'bijan robinson', 'breece hall', 'jahmyr gibbs',
      'derrick henry', 'jonathan taylor', 'saquon barkley', 'josh jacobs',
      'tyreek hill', 'ceedee lamb', 'amon-ra st. brown', 'justin jefferson',
      'stefon diggs', 'cooper kupp', 'puka nacua', 'garrett wilson',
      'travis kelce', 'sam lachance', 'george kittle', 'tj hockenson',
      'josh allen', 'lamar jackson', 'jalen hurts', 'patrick mahomes'
    ];

    // Good tier players (1.1-1.2x multiplier)
    const goodPlayers = [
      'tony pollard', 'rachaad white', 'devin singletary', 'chuba hubbard',
      'courtland sutton', 'dj moore', 'george pickens', 'josh downs',
      'jayden reed', 'drake london', 'zay flowers', 'brian thomas',
      'jonnu smith', 'dalton schultz', 'cole kmet', 'david njoku'
    ];

    // Below average tier (0.7-0.8x multiplier) - backups, bad situations
    const belowAverage = [
      'jerome ford', 'justice hill', 'roschon johnson', 'tyjae spears',
      'elijah mitchell', 'ty chandler', 'alexander mattison', 'jaleel mclaughlin',
      'tre tucker', 'josh reynolds', 'michael wilson', 'romeo doubs',
      'calvin austin', 'jalen tolbert', 'tyler boyd', 'kendrick bourne'
    ];

    // Bad offense teams get penalty
    const weakOffenses = ['CAR', 'NE', 'TEN', 'NYG', 'LV', 'JAX', 'CHI'];
    const goodOffenses = ['KC', 'SF', 'BAL', 'BUF', 'MIA', 'DAL', 'PHI', 'DET'];

    let multiplier = 1.0;

    // Check player tier
    if (elitePlayers.some(p => name.includes(p))) {
      multiplier = 1.4;
    } else if (goodPlayers.some(p => name.includes(p))) {
      multiplier = 1.15;
    } else if (belowAverage.some(p => name.includes(p))) {
      multiplier = 0.75;
    }

    // Team quality modifier
    if (weakOffenses.includes(team)) {
      multiplier *= 0.85;
    } else if (goodOffenses.includes(team)) {
      multiplier *= 1.1;
    }

    // Backup RBs and WR3+ get further penalty if not elite
    if (position === 'RB' && multiplier < 1.1) {
      // Additional penalty for known backups
      if (name.includes('hill') || name.includes('ford') || name.includes('mattison')) {
        multiplier *= 0.8;
      }
    }

    return multiplier;
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
      // Use real projection if available, otherwise estimate
      projection: player.realProjection ?? this.estimatePoints(player, scoringSettings)
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

    // Calculate current lineup points (use real projections if available)
    const currentPoints = formatted.starters.reduce((sum, player) => {
      return sum + (player.realProjection ?? this.estimatePoints(player, {}));
    }, 0);

    const recommendations = [];
    const MIN_IMPROVEMENT = 0.5; // Minimum points improvement to recommend a swap

    // Create maps for quick lookup
    const currentStarterIds = new Set(formatted.starters.map(p => p.playerId));
    const optimalStarterIds = new Set(optimal.lineup.filter(p => !p.empty).map(p => p.playerId));

    // Build a map of player positions in current lineup
    const currentPlayerPositions = new Map();
    formatted.starters.forEach((player, idx) => {
      currentPlayerPositions.set(player.playerId, { player, index: idx, position: player.position });
    });

    // Find all differences between current and optimal lineup
    optimal.lineup.forEach((optimalPlayer, idx) => {
      if (optimalPlayer.empty) return;

      const currentPlayer = formatted.starters[idx];

      // Skip if same player is already in this position
      if (currentPlayer.playerId === optimalPlayer.playerId) {
        return;
      }

      const isOptimalPlayerOnBench = !currentStarterIds.has(optimalPlayer.playerId);
      const isOptimalPlayerInDifferentSlot = currentStarterIds.has(optimalPlayer.playerId) &&
                                              currentPlayer.playerId !== optimalPlayer.playerId;

      if (isOptimalPlayerOnBench) {
        // Case 1: Bench player should start
        const currentPlayerProjection = currentPlayer.realProjection ?? this.estimatePoints(currentPlayer, {});
        const improvement = optimalPlayer.projection - currentPlayerProjection;

        if (improvement >= MIN_IMPROVEMENT) {
          recommendations.push({
            type: 'swap',
            out: { ...currentPlayer, projection: currentPlayerProjection },
            in: optimalPlayer,
            improvement,
            position: optimalPlayer.slotPosition
          });
        }
      } else if (isOptimalPlayerInDifferentSlot) {
        // Case 2: Starting player should move to different position
        const currentPosition = currentPlayerPositions.get(optimalPlayer.playerId);

        // Calculate the improvement from this position swap
        // This is a position optimization - both players are already starting
        const optimalPlayerInNewSlot = optimalPlayer.projection;
        const currentPlayerProjection = currentPlayer.realProjection ?? this.estimatePoints(currentPlayer, {});
        const currentPlayerInThisSlot = currentPlayerProjection;

        // Find what player is taking the optimal player's old slot
        const playerTakingOldSlot = optimal.lineup[currentPosition.index];
        const playerTakingOldSlotProjection = playerTakingOldSlot ? playerTakingOldSlot.projection : 0;
        const optimalPlayerInOldSlot = optimalPlayer.projection;

        // Net improvement from swapping positions
        const improvement = (optimalPlayerInNewSlot - currentPlayerInThisSlot) +
                           (playerTakingOldSlotProjection - optimalPlayerInOldSlot);

        if (improvement >= MIN_IMPROVEMENT) {
          recommendations.push({
            type: 'position_swap',
            player: optimalPlayer,
            fromPosition: currentPosition.index,
            toPosition: idx,
            fromSlot: formatted.starters[currentPosition.index].slotPosition || currentPosition.player.position,
            toSlot: optimalPlayer.slotPosition,
            improvement,
            affectedPlayer: currentPlayer
          });
        }
      }
    });

    // Sort recommendations by improvement (highest first)
    recommendations.sort((a, b) => b.improvement - a.improvement);

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

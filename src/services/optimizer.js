import { getBasePoints, getInjuryMultiplier } from '../data/scoringConstants.js';
import { isEliteOffense, isWeakOffense, TEAM_MULTIPLIERS } from '../data/teamRankings.js';

/**
 * Lineup optimizer using projections and scoring rules
 */
export class LineupOptimizer {
  constructor(rosterService) {
    this.rosterService = rosterService;
  }

  /**
   * Points to plan around for a player.
   *
   * Prefers the real weekly projection. When the feed loaded but has no entry
   * for a player, that player is not expected to play, so they score 0 - an
   * estimate there would invent points for someone who is not playing.
   * Estimates are only used when no projection feed is available at all.
   */
  projectionFor(player, scoringSettings = {}) {
    if (player?.realProjection != null) return player.realProjection;
    if (player?.projected === false && this.rosterService.hasProjections()) return 0;
    return this.estimatePoints(player, scoringSettings);
  }

  /**
   * Enhanced projection model with player quality tiers
   */
  estimatePoints(player, scoringSettings) {
    // Players on BYE get 0 points
    if (player.onBye) {
      return 0;
    }

    // Get base points for position
    let points = getBasePoints(player.position);

    // Apply injury multiplier
    points *= getInjuryMultiplier(player.injuryStatus);

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
      'tony pollard', 'devin singletary', 'rico dowdle', 'bucky irving',
      'courtland sutton', 'dj moore', 'george pickens', 'josh downs',
      'jayden reed', 'drake london', 'zay flowers', 'brian thomas',
      'jonnu smith', 'dalton schultz', 'cole kmet', 'david njoku'
    ];

    // Below average tier (0.7-0.8x multiplier) - backups, bad situations
    const belowAverage = [
      // Backup RBs
      'jerome ford', 'justice hill', 'roschon johnson', 'tyjae spears',
      'elijah mitchell', 'ty chandler', 'alexander mattison', 'jaleel mclaughlin',
      'bhayshul tuten', 'miles sanders', 'dameon pierce', 'zamir white',
      'antonio gibson', 'ronnie rivers', 'pierre strong', 'hassan haskins',
      'kendre miller', 'evan hull', 'joshua kelley', 'clyde edwards-helaire',
      'rachaad white', 'chuba hubbard', 'tyler allgeier', 'ray davis',
      // Backup/WR3-4 receivers
      'tre tucker', 'josh reynolds', 'michael wilson', 'romeo doubs',
      'calvin austin', 'jalen tolbert', 'tyler boyd', 'kendrick bourne',
      'jalen mcmillan', 'ray-ray mccloud', 'marvin mims', 'tutu atwell'
    ];

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
    if (isWeakOffense(team)) {
      multiplier *= TEAM_MULTIPLIERS.WEAK;
    } else if (isEliteOffense(team)) {
      multiplier *= TEAM_MULTIPLIERS.ELITE;
    }

    // Backup RBs and WR3+ get further penalty if not elite
    if (position === 'RB' && multiplier < 1.1) {
      // Additional penalty for known backups (common backup RB name patterns)
      const backupPatterns = [
        'hill', 'ford', 'mattison', 'tuten', 'spears', 'chandler',
        'mitchell', 'sanders', 'pierce', 'white', 'gibson', 'rivers',
        'strong', 'haskins', 'miller', 'hull', 'kelley', 'edwards-helaire',
        'mclaughlin', 'johnson', 'hubbard', 'allgeier', 'davis'
      ];
      if (backupPatterns.some(pattern => name.includes(pattern))) {
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
      projection: this.projectionFor(player, scoringSettings)
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
    const formatted = await this.rosterService.formatRoster(currentRoster, leagueId);
    const optimal = await this.optimizeLineup(leagueId, formatted);
    const scoringSettings = await this.rosterService.getScoringSettings(leagueId);

    // Calculate current lineup points (use real projections if available)
    const currentPoints = formatted.starters.reduce((sum, player) => {
      return sum + this.projectionFor(player, scoringSettings);
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
        const currentPlayerProjection = this.projectionFor(currentPlayer, scoringSettings);
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
        const currentPlayerProjection = this.projectionFor(currentPlayer, scoringSettings);
        const currentPlayerInThisSlot = currentPlayerProjection;

        // Find what player is taking the optimal player's old slot
        const playerTakingOldSlot = optimal.lineup[currentPosition.index];
        const playerTakingOldSlotProjection = playerTakingOldSlot ? playerTakingOldSlot.projection : 0;
        const optimalPlayerInOldSlot = optimalPlayer.projection;

        // Net improvement from swapping positions
        const improvement = (optimalPlayerInNewSlot - currentPlayerInThisSlot) +
                           (playerTakingOldSlotProjection - optimalPlayerInOldSlot);

        const fromSlot = formatted.starters[currentPosition.index].slotPosition
          || currentPosition.player.position;

        // Only worth reporting if the player actually changes slot.
        if (improvement >= MIN_IMPROVEMENT && fromSlot !== optimalPlayer.slotPosition) {
          recommendations.push({
            type: 'position_swap',
            player: optimalPlayer,
            fromPosition: currentPosition.index,
            toPosition: idx,
            fromSlot,
            toSlot: optimalPlayer.slotPosition,
            improvement,
            // Whoever the optimal lineup puts in the slot being vacated - not
            // the player currently sitting in the destination slot.
            affectedPlayer: playerTakingOldSlot?.empty ? null : playerTakingOldSlot
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

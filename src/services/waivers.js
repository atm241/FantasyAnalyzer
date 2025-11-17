import { POSITION_VALUE, isPlayerLikelyOut } from '../data/scoringConstants.js';
import { ELITE_OFFENSES } from '../data/teamRankings.js';

/**
 * Waiver wire analysis and recommendations
 */
export class WaiverAnalyzer {
  constructor(rosterService, api) {
    this.rosterService = rosterService;
    this.api = api;
  }

  /**
   * Score a player's waiver value (0-100)
   */
  scorePlayer(player, trending = false) {
    if (!player || typeof player !== 'object') {
      return 0;
    }

    let score = 50; // Base score

    // Players on BYE get reduced score
    if (player.onBye) {
      score -= 15;
    }

    // Position value
    score += POSITION_VALUE[player.position] || 0;

    // Active and healthy players get bonus
    if (player.status === 'Active' && !player.injuryStatus && !player.onBye) {
      score += 10;
    }

    // Injury penalties
    if (player.injuryStatus === 'Questionable') score -= 5;
    if (player.injuryStatus === 'Doubtful') score -= 15;
    if (isPlayerLikelyOut(player.injuryStatus)) score -= 30;

    // Trending bonus
    if (trending) {
      score += 20;
    }

    // Team matters (players on good teams score more)
    if (ELITE_OFFENSES.includes(player.team)) {
      score += 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Find best available players at each position
   */
  async getTopAvailable(leagueId, limit = 10) {
    const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
    const trending = await this.api.getTrendingPlayers('add', 24);
    const trendingIds = new Set(trending.map(t => t.player_id));

    const recommendations = {};

    for (const position of positions) {
      const available = await this.rosterService.getAvailablePlayers(leagueId, position);

      const scored = available.map(player => ({
        ...player,
        waiverScore: this.scorePlayer(player, trendingIds.has(player.playerId)),
        trending: trendingIds.has(player.playerId)
      }));

      scored.sort((a, b) => b.waiverScore - a.waiverScore);
      recommendations[position] = scored.slice(0, limit);
    }

    return recommendations;
  }

  /**
   * Analyze roster weaknesses and suggest pickups
   */
  async analyzeRosterNeeds(leagueId, roster) {
    const formatted = await this.rosterService.formatRoster(roster);
    const rosterPositions = await this.rosterService.getRosterPositions(leagueId);

    // Count players by position
    const positionCounts = {};
    const allPlayers = [...formatted.starters, ...formatted.bench];

    allPlayers.forEach(player => {
      positionCounts[player.position] = (positionCounts[player.position] || 0) + 1;
    });

    // Count required starters by position
    const requiredStarters = {};
    rosterPositions.forEach(pos => {
      if (pos !== 'BN' && !pos.includes('FLEX')) {
        requiredStarters[pos] = (requiredStarters[pos] || 0) + 1;
      }
    });

    // Identify weak positions (fewer than 2x required starters)
    const weakPositions = [];
    for (const [position, required] of Object.entries(requiredStarters)) {
      const current = positionCounts[position] || 0;
      if (current < required * 2) {
        weakPositions.push({
          position,
          current,
          recommended: required * 2,
          deficit: (required * 2) - current
        });
      }
    }

    // Get trending data once (performance optimization - avoid repeated API calls)
    const trending = await this.api.getTrendingPlayers('add', 24).catch(() => []);
    const trendingIds = new Set(trending.map(t => t.player_id));

    // Get top available for weak positions
    const targetedPickups = {};
    for (const weakness of weakPositions) {
      const available = await this.rosterService.getAvailablePlayers(leagueId, weakness.position);

      const scored = available.map(player => ({
        ...player,
        waiverScore: this.scorePlayer(player, trendingIds.has(player.playerId)),
        trending: trendingIds.has(player.playerId)
      }));

      scored.sort((a, b) => b.waiverScore - a.waiverScore);
      targetedPickups[weakness.position] = scored.slice(0, 5);
    }

    return {
      weakPositions,
      targetedPickups,
      positionCounts
    };
  }

  /**
   * Get trending players available on waivers
   */
  async getTrendingAvailable(leagueId) {
    const trending = await this.api.getTrendingPlayers('add', 24);
    const available = await this.rosterService.getAvailablePlayers(leagueId);
    const availableIds = new Set(available.map(p => p.playerId));

    return trending
      .filter(t => availableIds.has(t.player_id))
      .map(t => {
        const player = available.find(p => p.playerId === t.player_id);
        return {
          ...player,
          trendCount: t.count
        };
      })
      .slice(0, 20);
  }
}

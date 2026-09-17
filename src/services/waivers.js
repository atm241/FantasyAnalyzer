import { isPlayerLikelyOut } from '../data/scoringConstants.js';
import { isEliteOffense } from '../data/teamRankings.js';
import { realPlayers } from '../utils/playerName.js';
import { FANTASY_POSITIONS } from './positionValue.js';

/**
 * Waiver wire analysis and recommendations
 */
export class WaiverAnalyzer {
  constructor(rosterService, api) {
    this.rosterService = rosterService;
    this.api = api;
  }

  /**
   * Score a player's waiver value (0-100).
   *
   * Driven by how much the player beats what is freely available at their
   * position in this league, rather than a fixed per-position table. In a
   * three-flex PPR league that lifts receivers and flattens streamable
   * positions, which is what the league's own numbers say.
   */
  scorePlayer(player, trending = false, economics = null) {
    if (!player || typeof player !== 'object') {
      return 0;
    }

    let score = 50; // Base score

    // Players on BYE get reduced score
    if (player.onBye) {
      score -= 15;
    }

    const position = economics?.[player.position];
    if (position) {
      // Points above the best free alternative at this position, scaled so a
      // couple of points of edge is worth a meaningful amount of score.
      const edge = (player.realProjection ?? 0) - position.replacement;
      score += Math.max(-20, Math.min(30, edge * 3));

      // How much this league needs the position at all.
      score += Math.min(15, position.priority * 4);

      // Nothing to gain from hoarding a position you can refill any week.
      if (position.streamable) score -= 10;
      if (position.idealCount === 0) score -= 25;
    }

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
    if (isEliteOffense(player.team)) {
      score += 5;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Find best available players at each position
   */
  async getTopAvailable(leagueId, limit = 10) {
    const positions = FANTASY_POSITIONS;
    const economics = await this.rosterService.getEconomics(leagueId);
    const trending = await this.api.getTrendingPlayers('add', 24);
    const trendingIds = new Set(trending.map(t => t.player_id));

    const recommendations = {};

    for (const position of positions) {
      const available = await this.rosterService.getAvailablePlayers(leagueId, position);

      const scored = available.map(player => ({
        ...player,
        waiverScore: this.scorePlayer(player, trendingIds.has(player.playerId), economics),
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
    const formatted = await this.rosterService.formatRoster(roster, leagueId);
    const rosterPositions = await this.rosterService.getRosterPositions(leagueId);

    // Count players by position
    const positionCounts = {};
    const allPlayers = realPlayers([...formatted.starters, ...formatted.bench]);

    allPlayers.forEach(player => {
      positionCounts[player.position] = (positionCounts[player.position] || 0) + 1;
    });

    // What this league actually needs, flex slots included, measured against
    // what the waiver wire offers for free.
    const economics = await this.rosterService.getEconomics(leagueId, roster);

    // A position is weak when it is short of bodies for its dedicated slots, or
    // when a free agent would genuinely upgrade the lineup. Streamable
    // positions never qualify - the best one each week is always there.
    const weakPositions = [];
    for (const position of FANTASY_POSITIONS) {
      const economy = economics[position];
      if (!economy || economy.idealCount === 0) continue;

      const current = positionCounts[position] || 0;
      const shortOfSlots = current < economy.dedicatedSlots;
      const worthUpgrading = !economy.streamable && economy.priority >= 1;

      if (!shortOfSlots && !worthUpgrading) continue;

      weakPositions.push({
        position,
        current,
        recommended: economy.idealCount,
        deficit: Math.max(economy.idealCount - current, shortOfSlots ? 1 : 0),
        priority: economy.priority,
        streamable: economy.streamable,
        reason: shortOfSlots
          ? `only ${current} for ${economy.dedicatedSlots} starting slot(s)`
          : `waivers offer +${economy.priority.toFixed(1)} pts over your marginal starter`
      });
    }

    weakPositions.sort((a, b) => b.priority - a.priority);

    // Get trending data once (performance optimization - avoid repeated API calls)
    const trending = await this.api.getTrendingPlayers('add', 24).catch(() => []);
    const trendingIds = new Set(trending.map(t => t.player_id));

    // Get top available for weak positions
    const targetedPickups = {};
    for (const weakness of weakPositions) {
      const available = await this.rosterService.getAvailablePlayers(leagueId, weakness.position);

      const scored = available.map(player => ({
        ...player,
        waiverScore: this.scorePlayer(player, trendingIds.has(player.playerId), economics),
        trending: trendingIds.has(player.playerId)
      }));

      scored.sort((a, b) => b.waiverScore - a.waiverScore);
      targetedPickups[weakness.position] = scored.slice(0, 5);
    }

    return {
      weakPositions,
      targetedPickups,
      positionCounts,
      economics
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

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
    this.budget = null;
  }

  /**
   * FAAB position: what the league allows and what you have left to spend.
   * Returns null for leagues that do not use a bidding budget.
   */
  async getWaiverBudget(leagueId, userId) {
    if (this.budget !== null) return this.budget;

    const league = await this.api.getLeague(leagueId);
    const settings = league?.settings || {};

    // Sleeper waiver_type 2 is FAAB bidding.
    if (settings.waiver_type !== 2 || !settings.waiver_budget) {
      this.budget = false;
      return this.budget;
    }

    const rosters = await this.api.getLeagueRosters(leagueId);
    const mine = rosters.find(r => r.owner_id === userId);
    const spent = mine?.settings?.waiver_budget_used || 0;

    this.budget = {
      total: settings.waiver_budget,
      spent,
      remaining: Math.max(settings.waiver_budget - spent, 0)
    };
    return this.budget;
  }

  /**
   * Suggested FAAB bid for a target.
   *
   * Priced off the points the player adds over the best free alternative at
   * their position, across the weeks left to play - so a genuine starter costs
   * real budget and a one-week streamer costs a dollar.
   */
  suggestBid(player, economics, budget, weeksRemaining = 12) {
    if (!budget || budget.remaining <= 0) return null;

    const economy = economics?.[player.position];
    if (!economy || economy.idealCount === 0) return { amount: 0, note: 'not startable in this league' };

    // Priced against the player they would actually displace in your lineup,
    // not against the best free agent - the top target is that free agent, so
    // that comparison is always zero.
    const weeklyEdge = (player.realProjection ?? 0) - economy.incumbent;

    // Nothing gained over a free agent you could add for nothing.
    if (weeklyEdge <= 0.5 || economy.streamable) {
      return {
        amount: Math.min(1, budget.remaining),
        note: economy.streamable ? 'minimum bid - streamable position' : 'minimum bid - no real upgrade'
      };
    }

    const seasonEdge = weeklyEdge * Math.max(weeksRemaining, 1);

    // Share of the remaining budget, capped so one add cannot spend the season.
    const share = Math.min(seasonEdge / 120, 0.35);
    const amount = Math.max(1, Math.round(budget.remaining * share));

    return {
      amount: Math.min(amount, budget.remaining),
      note: `+${weeklyEdge.toFixed(1)} pts/wk over your marginal starter`
    };
  }

  /**
   * Rank by waiver score, breaking ties on the projection behind it. Scores are
   * whole numbers, so without this a 0.2-point edge disappears in rounding.
   */
  static byWaiverValue(a, b) {
    if (b.waiverScore !== a.waiverScore) return b.waiverScore - a.waiverScore;
    return (b.realProjection ?? 0) - (a.realProjection ?? 0);
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
      score += Math.max(-25, Math.min(30, edge * 5));

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

    // Trending is a popularity signal, not a value one: it says other managers
    // are adding the player, which is worth a nudge but must not outrank a
    // materially better projection.
    if (trending) {
      score += 5;
    }

    // Team quality is only applied when there is no real projection to lean on.
    // A projection already prices in the offence a player plays for, so adding
    // a bonus on top double-counts it - it was ranking an 8.2 receiver on a good
    // offence above an 8.5 receiver on an average one.
    if (player.realProjection == null && isEliteOffense(player.team)) {
      score += 5;
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Find best available players at each position
   */
  async getTopAvailable(leagueId, limit = 10, roster = null) {
    const positions = FANTASY_POSITIONS;
    // Same economics the needs analysis uses, so both rank against your own
    // lineup rather than two different baselines.
    const economics = await this.rosterService.getEconomics(leagueId, roster);
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

      scored.sort(WaiverAnalyzer.byWaiverValue);
      recommendations[position] = scored.slice(0, limit);
    }

    return recommendations;
  }

  /**
   * Analyze roster weaknesses and suggest pickups
   */
  async analyzeRosterNeeds(leagueId, roster, userId = null) {
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

    const budget = userId ? await this.getWaiverBudget(leagueId, userId) : null;
    const { week } = await this.rosterService.getNFLState();
    const weeksRemaining = Math.max(18 - week, 1);

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

      scored.sort(WaiverAnalyzer.byWaiverValue);
      targetedPickups[weakness.position] = scored.slice(0, 5).map(player => ({
        ...player,
        bid: this.suggestBid(player, economics, budget, weeksRemaining)
      }));
    }

    return {
      weakPositions,
      targetedPickups,
      positionCounts,
      economics,
      budget
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

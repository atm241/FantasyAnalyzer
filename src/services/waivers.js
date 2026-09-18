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
   * Rest-of-season context for pricing bids: what each player is projected to
   * score from here, and what the weakest player you would actually start is
   * worth over the same stretch.
   */
  async buildBidContext(leagueId, roster) {
    const outlook = await this.rosterService.getRestOfSeasonOutlook(leagueId);
    const rosFor = player => {
      const entry = outlook.players[player.playerId];
      return entry ? entry.restOfSeason + entry.playoff : 0;
    };

    const formatted = await this.rosterService.formatRoster(roster, leagueId);
    const rosterPositions = await this.rosterService.getRosterPositions(leagueId);
    const startingSlots = rosterPositions.filter(slot => slot !== 'BN').length;

    // Your starters ranked by rest-of-season value; the last one is the bar a
    // waiver add has to clear.
    const ranked = realPlayers([...formatted.starters, ...formatted.bench])
      .map(rosFor)
      .sort((a, b) => b - a);

    return {
      rosFor,
      rosMarginal: ranked[Math.max(startingSlots - 1, 0)] ?? 0
    };
  }

  /**
   * Suggested FAAB bid for a target.
   *
   * Priced off the points the player adds over the best free alternative at
   * their position, across the weeks left to play - so a genuine starter costs
   * real budget and a one-week streamer costs a dollar.
   */
  suggestBid(player, economics, budget, context = {}) {
    if (!budget || budget.remaining <= 0) return null;

    const economy = economics?.[player.position];
    if (!economy || economy.idealCount === 0) {
      return { amount: 0, note: 'not startable in this league' };
    }

    // Priced on the rest of the season, not one week. A bid buys a roster spot
    // for the remainder, so a player who starts for you every week is worth far
    // more than one who happens to project well on Sunday.
    const rosGain = (context.rosFor?.(player) ?? 0) - (context.rosMarginal ?? 0);

    if (economy.streamable || rosGain <= 2) {
      return {
        amount: Math.min(1, budget.remaining),
        note: economy.streamable ? 'minimum bid - streamable position' : 'minimum bid - no real upgrade'
      };
    }

    // A player worth this many points over your marginal starter for the rest
    // of the season justifies the maximum share of what is left.
    const REFERENCE_GAIN = 150;
    const share = Math.min(rosGain / REFERENCE_GAIN, 0.35);
    const amount = Math.max(1, Math.round(budget.remaining * share));

    return {
      amount: Math.min(amount, budget.remaining),
      note: `+${Math.round(rosGain)} pts rest-of-season over your marginal starter`
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
    const bidContext = await this.buildBidContext(leagueId, roster);

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
        bid: this.suggestBid(player, economics, budget, bidContext)
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

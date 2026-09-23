import { getPlayerName, realPlayers } from '../utils/playerName.js';

/**
 * Look up one player and answer the practical question: should I add them, what
 * should I bid, and who do I drop?
 *
 * The full analysis answers "what should I do this week"; this answers "what
 * about this specific guy", which is how waiver decisions actually get made.
 */
export class PlayerLookupService {
  constructor(api, rosterService, waiverAnalyzer, firstToGo) {
    this.api = api;
    this.rosterService = rosterService;
    this.waiverAnalyzer = waiverAnalyzer;
    this.firstToGo = firstToGo;
  }

  /**
   * Find players whose name matches a query. Exact full-name matches win, then
   * players who are actually relevant (on a team) rank above the rest.
   */
  async findCandidates(query) {
    const players = await this.rosterService.loadPlayers();
    const needle = query.trim().toLowerCase();
    if (!needle) return [];

    const matches = [];
    for (const [playerId, player] of Object.entries(players)) {
      const name = getPlayerName(player, '').toLowerCase();
      if (!name) continue;

      const exact = name === needle;
      if (!exact && !name.includes(needle)) continue;

      matches.push({ playerId, player, exact, rostered: Boolean(player.team) });
    }

    return matches
      .sort((a, b) =>
        (b.exact - a.exact) ||
        (b.rostered - a.rostered) ||
        ((a.player.search_rank ?? 9e9) - (b.player.search_rank ?? 9e9))
      )
      .slice(0, 8);
  }

  /**
   * Build the full picture for one player in the context of your league.
   */
  async analyze(leagueId, userId, playerId, contention = null) {
    const players = await this.rosterService.loadPlayers();
    const record = players[playerId];
    if (!record) return null;

    const [rosters, users, economics, outlook, scoringSettings] = await Promise.all([
      this.api.getLeagueRosters(leagueId),
      this.api.getLeagueUsers(leagueId),
      this.rosterService.getEconomics(leagueId, null),
      this.rosterService.getRestOfSeasonOutlook(leagueId),
      this.rosterService.getScoringSettings(leagueId)
    ]);

    const myRoster = rosters.find(r => r.owner_id === userId);
    const ownerRoster = rosters.find(r => r.players?.includes(playerId));
    const ownerUser = ownerRoster
      ? users.find(u => u.user_id === ownerRoster.owner_id)
      : null;

    // Economics measured against your own lineup, not the league at large.
    const myEconomics = await this.rosterService.getEconomics(leagueId, myRoster);

    const projection = this.rosterService.buildProjection(playerId, scoringSettings);
    const ros = outlook.players[playerId] || { restOfSeason: 0, playoff: 0 };

    const target = {
      playerId,
      name: getPlayerName(record),
      position: record.position,
      team: record.team || 'FA',
      searchRank: record.search_rank ?? null,
      depthChartOrder: record.depth_chart_order ?? null,
      injuryStatus: record.injury_status || null,
      injuryBodyPart: record.injury_body_part || null,
      ...projection,
      restOfSeason: ros.restOfSeason,
      playoffPoints: ros.playoff
    };

    const onYourRoster = ownerRoster?.roster_id === myRoster?.roster_id;
    const owner = onYourRoster
      ? 'you'
      : ownerUser
        ? (ownerUser.metadata?.team_name || ownerUser.display_name)
        : null;

    const result = {
      target,
      owner,
      onYourRoster,
      available: !ownerRoster,
      economy: myEconomics[record.position] || null,
      week: outlook.fromWeek,
      playoffStart: outlook.playoffStart
    };

    if (result.available && myRoster) {
      result.bid = await this.bidFor(leagueId, userId, myRoster, target, myEconomics, contention);
      result.drop = await this.dropFor(leagueId, myRoster);
      result.lineupImpact = await this.lineupImpact(leagueId, myRoster, target, outlook);
    }

    return result;
  }

  /** Suggested FAAB bid, using the same pricing as the waiver report. */
  async bidFor(leagueId, userId, myRoster, target, economics, contention = null) {
    const budget = await this.waiverAnalyzer.getWaiverBudget(leagueId, userId);
    if (!budget) return { budget: null };

    const context = {
      ...(await this.waiverAnalyzer.buildBidContext(leagueId, myRoster)),
      contention
    };
    return {
      budget,
      suggestion: this.waiverAnalyzer.suggestBid(target, economics, budget, context),
      dropping: context.dropping
    };
  }

  /** Who you would cut to make room. */
  async dropFor(leagueId, myRoster) {
    const formatted = await this.rosterService.formatRoster(myRoster, leagueId);
    const week = await this.rosterService.getCurrentWeek();
    const analysis = await this.firstToGo.analyzeFirstToGo(formatted, week, leagueId);

    const held = realPlayers([...formatted.starters, ...formatted.bench]).length;
    const capacity = formatted.starters.length + formatted.bench.length;

    return {
      bestDrop: analysis.bestDrop,
      rosterFull: held >= capacity,
      held,
      capacity
    };
  }

  /**
   * Where the player would land among the players you can actually start, and
   * what they would add over the rest of the season.
   */
  async lineupImpact(leagueId, myRoster, target, outlook) {
    const formatted = await this.rosterService.formatRoster(myRoster, leagueId);
    const rosterPositions = await this.rosterService.getRosterPositions(leagueId);

    const valueOf = player => {
      const entry = outlook.players[player.playerId];
      return entry ? entry.restOfSeason + entry.playoff : 0;
    };

    // Only compare against players competing for the same slots. A receiver
    // does not displace your defence, however few points it is projected.
    const flexPositions = ['RB', 'WR', 'TE'];
    const competesWith = flexPositions.includes(target.position)
      ? flexPositions
      : [target.position];

    // Every starting slot the competing group can fill: their own positions
    // plus any flex slot. For RB/WR/TE in this league that is RB, RB, WR, WR,
    // TE and three FLEX - eight, not just the target's own position.
    const relevantSlots = rosterPositions.filter(slot =>
      slot !== 'BN' &&
      (competesWith.includes(slot) || (competesWith.length > 1 && slot.includes('FLEX')))
    ).length;

    const rivals = realPlayers([...formatted.starters, ...formatted.bench])
      .filter(player => competesWith.includes(player.position))
      .map(player => ({ name: player.name, value: valueOf(player) }))
      .sort((a, b) => b.value - a.value);

    const targetValue = target.restOfSeason + target.playoffPoints;
    const rank = rivals.filter(p => p.value > targetValue).length + 1;
    const displaced = rivals[relevantSlots - 1] || null;

    return {
      rank,
      of: rivals.length + 1,
      startingSlots: relevantSlots,
      positions: competesWith,
      wouldStart: rank <= relevantSlots,
      displaced,
      gain: displaced ? targetValue - displaced.value : targetValue
    };
  }
}

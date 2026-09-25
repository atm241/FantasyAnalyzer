import { getWatchlist } from '../utils/savedLeagues.js';
import { getPlayerName } from '../utils/playerName.js';

/**
 * Players you are tracking, re-valued against your roster as it stands now.
 *
 * A free agent's worth changes week to week as your roster, byes and their role
 * move. This answers "has anyone I am watching become worth claiming yet"
 * without looking each of them up by hand.
 */
export class WatchlistService {
  constructor(api, rosterService, waiverAnalyzer) {
    this.api = api;
    this.rosterService = rosterService;
    this.waiverAnalyzer = waiverAnalyzer;
  }

  /**
   * Evaluate every watched player for a league.
   *
   * @returns {object[]} entries with current value, bid, ownership and movement
   */
  async evaluate(leagueId, userId, economics, contention = null) {
    const watched = getWatchlist(leagueId);
    if (watched.length === 0) return [];

    const [players, rosters, users] = await Promise.all([
      this.rosterService.loadPlayers(),
      this.api.getLeagueRosters(leagueId),
      this.api.getLeagueUsers(leagueId)
    ]);

    const myRoster = rosters.find(r => r.owner_id === userId);
    const budget = await this.waiverAnalyzer.getWaiverBudget(leagueId, userId);
    const context = {
      ...(await this.waiverAnalyzer.buildBidContext(leagueId, myRoster)),
      contention
    };

    const scoringSettings = await this.rosterService.getScoringSettings(leagueId);

    return watched.map(item => {
      const record = players[item.playerId];
      if (!record) {
        return { ...item, missing: true };
      }

      const ownerRoster = rosters.find(r => r.players?.includes(item.playerId));
      const ownerUser = ownerRoster
        ? users.find(u => u.user_id === ownerRoster.owner_id)
        : null;
      const mine = ownerRoster?.roster_id === myRoster?.roster_id;

      const candidate = {
        playerId: item.playerId,
        name: getPlayerName(record),
        position: record.position,
        team: record.team || 'FA',
        injuryStatus: record.injury_status || null,
        searchRank: record.search_rank ?? null,
        ...this.rosterService.buildProjection(item.playerId, scoringSettings)
      };

      const available = !ownerRoster;
      const gain = available ? Math.round(context.lineupGain(candidate)) : null;
      const bid = available && budget
        ? this.waiverAnalyzer.suggestBid(candidate, economics, budget, context)
        : null;

      return {
        ...item,
        ...candidate,
        available,
        mine,
        owner: mine
          ? 'you'
          : ownerUser?.metadata?.team_name || ownerUser?.display_name || null,
        gain,
        bid,
        // Movement since the last run, which is the point of watching.
        change: gain != null && item.lastGain != null ? gain - item.lastGain : null
      };
    });
  }
}

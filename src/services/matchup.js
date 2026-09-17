import { realPlayers } from '../utils/playerName.js';

/**
 * This week's head-to-head matchup.
 *
 * The league already fetches weekly matchups for the playoff simulation; this
 * turns the same data into the thing you actually want to see on a Sunday -
 * who you are playing, the projected score, and who decides it.
 */
export class MatchupService {
  constructor(api, rosterService, optimizer) {
    this.api = api;
    this.rosterService = rosterService;
    this.optimizer = optimizer;
  }

  /**
   * Build the current matchup for a user, or null when the league has no
   * matchup this week (bye weeks in odd-sized leagues, preseason).
   */
  async getCurrentMatchup(leagueId, userId) {
    const week = await this.rosterService.getCurrentWeek();
    const [matchups, rosters, users] = await Promise.all([
      this.api.getMatchups(leagueId, week).catch(() => []),
      this.api.getLeagueRosters(leagueId),
      this.api.getLeagueUsers(leagueId)
    ]);

    const myRoster = rosters.find(r => r.owner_id === userId);
    if (!myRoster) return null;

    const mine = matchups.find(m => m.roster_id === myRoster.roster_id);
    if (!mine?.matchup_id) return null;

    const theirs = matchups.find(
      m => m.matchup_id === mine.matchup_id && m.roster_id !== mine.roster_id
    );
    if (!theirs) return null;

    const theirRoster = rosters.find(r => r.roster_id === theirs.roster_id);
    const nameFor = roster => {
      const user = users.find(u => u.user_id === roster?.owner_id);
      return user?.metadata?.team_name || user?.display_name || `Team ${roster?.roster_id}`;
    };

    const [you, opponent] = await Promise.all([
      this.sideOf(leagueId, myRoster, mine, nameFor(myRoster)),
      this.sideOf(leagueId, theirRoster, theirs, nameFor(theirRoster))
    ]);

    return {
      week,
      you,
      opponent,
      margin: you.projected - opponent.projected,
      winProbability: winProbability(you.projected, opponent.projected)
    };
  }

  /** One side of the matchup: projected total and the players driving it. */
  async sideOf(leagueId, roster, matchup, teamName) {
    const formatted = await this.rosterService.formatRoster(roster, leagueId);
    const starters = realPlayers(formatted.starters);

    const scored = starters.map(player => ({
      ...player,
      projection: this.optimizer.projectionFor(player),
      actual: matchup?.starters_points?.[
        (matchup.starters || []).indexOf(player.playerId)
      ] ?? null
    }));

    return {
      teamName,
      record: `${roster?.settings?.wins ?? 0}-${roster?.settings?.losses ?? 0}`,
      projected: scored.reduce((sum, p) => sum + p.projection, 0),
      actual: matchup?.points ?? 0,
      starters: scored,
      // Who swings the week most, for a quick read on where it is won or lost.
      topPlayers: [...scored].sort((a, b) => b.projection - a.projection).slice(0, 3)
    };
  }
}

/**
 * Win probability from the projected margin.
 *
 * Weekly fantasy scores vary a lot: a standard deviation of roughly 25 points
 * on a team total is typical, so the margin is read against that spread rather
 * than treated as decisive.
 */
export function winProbability(yourPoints, theirPoints, spread = 25) {
  const z = (yourPoints - theirPoints) / spread;
  // Logistic approximation of the normal CDF - close enough and dependency free.
  return 1 / (1 + Math.exp(-1.702 * z));
}

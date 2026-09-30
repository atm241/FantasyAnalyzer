import { getPlayerName, isEmptySlot } from '../utils/playerName.js';
import { getGameState, getGame, loadSchedule } from '../data/nflSchedule.js';

/**
 * The live Sunday scoreboard.
 *
 * During games the useful view is not analysis, it is the head-to-head: your
 * starters against your opponent's, slot by slot, with what each has scored so
 * far. This builds that from the same matchup feed the standings already use.
 */

/** Sunday, from the early kickoffs until the night game is safely over. */
const GAMEDAY = { weekday: 'Sun', fromHour: 12, toHour: 23, toMinute: 30 };

/**
 * Whether the live view should take over, measured in US Central time so it
 * matches kickoff regardless of where the tool is being run.
 */
export function isGameday(now = new Date(), zone = 'America/Chicago') {
  const { weekday, hour, minute } = zonedParts(now, zone);
  if (weekday !== GAMEDAY.weekday) return false;
  if (hour < GAMEDAY.fromHour) return false;
  if (hour > GAMEDAY.toHour) return false;
  if (hour === GAMEDAY.toHour && minute > GAMEDAY.toMinute) return false;
  return true;
}

/** Weekday, hour and minute in a named timezone. */
export function zonedParts(now, zone = 'America/Chicago') {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).formatToParts(now);

  const find = type => parts.find(part => part.type === type)?.value;
  return {
    weekday: find('weekday'),
    // Midnight comes back as 24 in some environments.
    hour: Number(find('hour')) % 24,
    minute: Number(find('minute'))
  };
}

export class GamedayService {
  constructor(api, rosterService) {
    this.api = api;
    this.rosterService = rosterService;
  }

  /**
   * Build the live head-to-head for a user, slot by slot.
   *
   * Sleeper's starters array is parallel to the league's starting slots, and
   * starters_points is parallel to that, so the two line up directly.
   */
  /** This week's projection for a player, when the roster service has it. */
  projectedFor(playerId) {
    const stats = this.rosterService.projections?.[playerId];
    if (!stats) return 0;
    return stats.pts_ppr ?? stats.pts_half_ppr ?? stats.pts_std ?? 0;
  }

  async getLiveMatchup(leagueId, userId) {
    const week = await this.rosterService.getCurrentWeek();
    const [matchups, rosters, users, league, players] = await Promise.all([
      this.api.getMatchups(leagueId, week).catch(() => []),
      this.api.getLeagueRosters(leagueId),
      this.api.getLeagueUsers(leagueId),
      this.api.getLeague(leagueId),
      this.rosterService.loadPlayers()
    ]);

    // Game state comes from the schedule, which is fetched fresh each run.
    // Projections are needed to say how many points are still to come.
    const season = (await this.rosterService.getNFLState()).season;
    await Promise.all([
      loadSchedule(season).catch(() => null),
      this.rosterService.loadProjections().catch(() => null)
    ]);

    const myRoster = rosters.find(r => r.owner_id === userId);
    const mine = matchups.find(m => m.roster_id === myRoster?.roster_id);
    if (!mine?.matchup_id) return null;

    const theirs = matchups.find(
      m => m.matchup_id === mine.matchup_id && m.roster_id !== mine.roster_id
    );
    if (!theirs) return null;

    const slots = (league?.roster_positions || []).filter(slot => slot !== 'BN');
    const nameFor = rosterId => {
      const roster = rosters.find(r => r.roster_id === rosterId);
      const user = users.find(u => u.user_id === roster?.owner_id);
      return user?.metadata?.team_name || user?.display_name || `Team ${rosterId}`;
    };

    const side = entry => {
      const starters = (entry.starters || []).map((playerId, index) => {
        const record = players[playerId];
        const team = record?.team || null;
        const state = isEmptySlot(playerId) ? 'empty' : getGameState(team, week);

        return {
          slot: slots[index] || '--',
          playerId,
          name: isEmptySlot(playerId) ? '(empty)' : getPlayerName(record),
          position: record?.position || '--',
          team: team || '--',
          points: entry.starters_points?.[index] ?? 0,
          empty: isEmptySlot(playerId),
          state,
          opponent: getGame(team, week)?.opponent || null
        };
      });

      // What is still to come is the thing a deficit has to be read against.
      const remaining = starters.filter(p => p.state === 'upcoming');

      return {
        teamName: nameFor(entry.roster_id),
        total: entry.points || 0,
        starters,
        yetToPlay: remaining.length,
        playing: starters.filter(p => p.state === 'playing').length,
        // Points still on the table, from the projections already loaded.
        remainingProjected: remaining.reduce(
          (sum, p) => sum + (this.projectedFor(p.playerId) ?? 0), 0
        )
      };
    };

    return {
      week,
      slots,
      you: side(mine),
      opponent: side(theirs),
      margin: (mine.points || 0) - (theirs.points || 0)
    };
  }
}

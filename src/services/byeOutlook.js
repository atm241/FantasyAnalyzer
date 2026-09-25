import { getByeWeek, getTeamsOnBye } from '../data/nflSchedule.js';
import { bestLineupValue } from './lineupValue.js';
import { realPlayers } from '../utils/playerName.js';

/**
 * Bye weeks you have to plan around.
 *
 * Byes were detected but only ever checked for the current week, which means
 * you found out four starters were off in the same week during that week. This
 * looks forward across the rest of the season while there is still time to act.
 */

/** Losing this share of a normal week's lineup is worth warning about. */
const TROUBLE_THRESHOLD = 0.2;

/**
 * Week-by-week outlook for a roster: who is on bye, and what the best lineup
 * you could field that week is worth.
 *
 * @param {object} input
 * @param {object[]} input.roster your players
 * @param {string[]} input.rosterPositions league slots including BN
 * @param {object} input.outlook rest-of-season outlook with per-week points
 */
export function buildByeOutlook({ roster, rosterPositions, outlook }) {
  const players = realPlayers(roster);
  const weeks = outlook?.weeks || [];
  if (weeks.length === 0) return { weeks: [], trouble: [], byeWeeksByPlayer: {} };

  const pointsIn = (player, week) =>
    outlook.players?.[player.playerId]?.byWeek?.[week] ?? 0;

  // A typical week, used as the baseline a bye week is measured against.
  const weekly = weeks.map(week => ({
    week,
    value: bestLineupValue(players, rosterPositions, p => pointsIn(p, week)),
    onBye: players.filter(player => getByeWeek(player.team) === week)
  }));

  const healthy = weekly
    .filter(entry => entry.onBye.length === 0)
    .map(entry => entry.value);
  const baseline = healthy.length
    ? healthy.reduce((sum, v) => sum + v, 0) / healthy.length
    : Math.max(...weekly.map(entry => entry.value), 1);

  const detailed = weekly.map(entry => {
    const shortfall = baseline > 0 ? (baseline - entry.value) / baseline : 0;
    return {
      ...entry,
      baseline,
      shortfall,
      // Teams on bye league-wide, for context on how thin the waiver wire is.
      teamsOnBye: getTeamsOnBye(entry.week).length,
      trouble: entry.onBye.length > 0 && shortfall >= TROUBLE_THRESHOLD
    };
  });

  const byeWeeksByPlayer = {};
  for (const player of players) {
    const bye = getByeWeek(player.team);
    if (bye) byeWeeksByPlayer[player.playerId] = bye;
  }

  // Positions where a week arrives with nobody able to fill a slot you must
  // start. "Streamable" is no comfort if you have nobody at all that week.
  const required = [...new Set(
    (rosterPositions || []).filter(slot => slot !== 'BN' && !slot.includes('FLEX'))
  )];

  const uncovered = {};
  for (const entry of detailed) {
    for (const position of required) {
      const availableThatWeek = players.filter(player =>
        player.position === position && getByeWeek(player.team) !== entry.week
      );
      if (availableThatWeek.length === 0) {
        (uncovered[position] ||= []).push(entry.week);
      }
    }
  }

  return {
    weeks: detailed,
    trouble: detailed.filter(entry => entry.trouble),
    uncovered,
    byeWeeksByPlayer,
    baseline
  };
}

/**
 * How much a player helps in the weeks you are actually short.
 *
 * A pickup who plays while four of your starters are off is worth more than his
 * season total suggests, and one who shares your bye week is worth less.
 */
export function byeCoverageValue(player, byeOutlook, outlook) {
  if (!byeOutlook?.trouble?.length) return 0;

  const playerBye = getByeWeek(player.team);
  let covered = 0;

  for (const week of byeOutlook.trouble) {
    if (playerBye === week.week) continue; // off the same week, no help
    covered += outlook?.players?.[player.playerId]?.byWeek?.[week.week] ?? 0;
  }

  return covered;
}

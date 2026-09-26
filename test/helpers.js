/**
 * Fixtures for the valuation tests.
 *
 * Everything here is synthetic and offline: these tests exist to pin down
 * behaviour that has broken before, so they must not depend on a live feed or
 * on what any real roster happens to look like this week.
 */

/** A league that starts QB, RB, RB, WR, WR, TE, three FLEX and a DEF. */
export const THREE_FLEX_PPR = [
  'QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'FLEX', 'DEF',
  'BN', 'BN', 'BN', 'BN', 'BN', 'BN'
];

let nextId = 1;

/** Build a player with only the fields the valuation code reads. */
export function player(name, position, points, extra = {}) {
  return {
    playerId: extra.playerId || `p${nextId++}`,
    name,
    position,
    team: extra.team || 'KC',
    realProjection: points,
    projected: true,
    ...extra
  };
}

/** Value function over a flat points map, for lineup tests. */
export function pointsOf(player) {
  return player.realProjection ?? 0;
}

/**
 * A schedule payload shaped like the live feed: every team plays every week
 * except the byes given.
 */
export function scheduleFixture({ teams, weeks, byes = {} }) {
  const games = [];

  for (let week = 1; week <= weeks; week++) {
    const playing = teams.filter(team => byes[team] !== week);

    for (let i = 0; i + 1 < playing.length; i += 2) {
      games.push({
        week,
        home: playing[i],
        away: playing[i + 1],
        // Thursday start, Monday finish, mirroring a real NFL week.
        date: dayOfSeason(week, i === 0 ? 0 : 3)
      });
    }
  }

  return games;
}

/** Deterministic dates: week 1 starts 2026-09-10, weeks run Thu to Mon. */
function dayOfSeason(week, offset) {
  const start = new Date(Date.UTC(2026, 8, 10));
  start.setUTCDate(start.getUTCDate() + (week - 1) * 7 + offset);
  return start.toISOString().slice(0, 10);
}

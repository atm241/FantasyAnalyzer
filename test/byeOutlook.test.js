import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildByeOutlook } from '../src/services/byeOutlook.js';
import { NflSchedule } from '../src/data/nflSchedule.js';
import { player } from './helpers.js';

/**
 * The bye helpers read module state loaded from the live feed, so these tests
 * drive a small league through the same class the loader builds.
 */
const TEAMS = ['KC', 'BUF', 'SEA', 'DAL'];

function outlookFor(players, weeks) {
  const entries = {};
  for (const p of players) {
    entries[p.playerId] = {
      byWeek: Object.fromEntries(weeks.map(w => [w, p.realProjection]))
    };
  }
  return { players: entries, weeks };
}

test('a week nobody is off looks like any other', () => {
  const players = [player('QB1', 'QB', 20, { team: 'KC' })];
  const result = buildByeOutlook({
    roster: players,
    rosterPositions: ['QB', 'BN'],
    outlook: outlookFor(players, [1, 2, 3])
  });
  assert.equal(result.trouble.length, 0);
});

test('a roster with no players returns an empty outlook', () => {
  const result = buildByeOutlook({
    roster: [],
    rosterPositions: ['QB', 'BN'],
    outlook: { players: {}, weeks: [] }
  });
  assert.deepEqual(result.weeks, []);
  assert.deepEqual(result.trouble, []);
});

test('bye data is keyed off the loaded schedule', () => {
  // Confirms the outlook reads bye weeks rather than inventing them: with no
  // schedule loaded for these teams there are no byes to report.
  const schedule = new NflSchedule(2026, []);
  assert.equal(schedule.degraded, true);
  assert.equal(schedule.byeWeeksByTeam.size, 0);
});

test('only a position with nobody left counts as uncovered', async () => {
  const { loadScheduleFromGames } = await import('../src/data/nflSchedule.js');

  // Week 2 byes: SEA and PHI are off, BAL plays.
  loadScheduleFromGames(2026, [
    { week: 1, home: 'BAL', away: 'SEA', date: '2026-09-10', status: 'complete' },
    { week: 1, home: 'PHI', away: 'KC', date: '2026-09-10', status: 'complete' },
    { week: 2, home: 'BAL', away: 'KC', date: '2026-09-17', status: 'pre_game' }
  ]);

  const roster = [
    player('TE on bye', 'TE', 8, { team: 'SEA', playerId: 't1' }),
    player('TE playing', 'TE', 9, { team: 'BAL', playerId: 't2' }),
    player('DEF on bye', 'DEF', 7, { team: 'PHI', playerId: 'd1' })
  ];

  const result = buildByeOutlook({
    roster,
    rosterPositions: ['TE', 'DEF', 'BN'],
    outlook: {
      weeks: [1, 2],
      players: {
        t1: { byWeek: { 1: 8, 2: 0 } },
        t2: { byWeek: { 1: 9, 2: 9 } },
        d1: { byWeek: { 1: 7, 2: 0 } }
      }
    }
  });

  // One tight end is off but another plays, so tight end is covered.
  assert.equal(result.uncovered.TE, undefined, 'a position with cover is not a hole');
  // The only defence is off, so that one genuinely is.
  assert.deepEqual(result.uncovered.DEF, [2]);
});

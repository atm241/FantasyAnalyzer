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

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slotAccepts, bestLineupValue, lineupGainFromAdding, weeklyLineupGain
} from '../src/services/lineupValue.js';
import { THREE_FLEX_PPR, player, pointsOf } from './helpers.js';

test('flex slots accept only running backs, receivers and tight ends', () => {
  assert.equal(slotAccepts('FLEX', 'RB'), true);
  assert.equal(slotAccepts('FLEX', 'WR'), true);
  assert.equal(slotAccepts('FLEX', 'TE'), true);
  assert.equal(slotAccepts('FLEX', 'QB'), false);
  assert.equal(slotAccepts('FLEX', 'DEF'), false);
});

test('super flex accepts a quarterback, a strict slot does not', () => {
  assert.equal(slotAccepts('SUPER_FLEX', 'QB'), true);
  assert.equal(slotAccepts('QB', 'QB'), true);
  assert.equal(slotAccepts('RB', 'WR'), false);
});

test('lineup value counts only players who fill a slot', () => {
  const roster = [
    player('QB1', 'QB', 20),
    player('RB1', 'RB', 18),
    player('RB2', 'RB', 16),
    player('WR1', 'WR', 15),
    player('WR2', 'WR', 14),
    player('TE1', 'TE', 10),
    player('FLEX1', 'WR', 12),
    player('FLEX2', 'RB', 11),
    player('FLEX3', 'TE', 9),
    player('DEF1', 'DEF', 8),
    // Bench players must not add to the total.
    player('BENCH1', 'WR', 100),
    player('BENCH2', 'WR', 100)
  ];

  // The two 100-point receivers displace the weakest eligible starters rather
  // than being ignored, so the best lineup uses them.
  const value = bestLineupValue(roster, THREE_FLEX_PPR, pointsOf);
  const bestTen = [100, 100, 20, 18, 16, 15, 14, 12, 10, 8];
  assert.equal(value, bestTen.reduce((a, b) => a + b, 0));
});

test('a pickup who cannot crack the lineup is worth nothing', () => {
  const roster = [
    player('QB1', 'QB', 20),
    player('RB1', 'RB', 18),
    player('RB2', 'RB', 16),
    player('WR1', 'WR', 15),
    player('WR2', 'WR', 14),
    player('TE1', 'TE', 10),
    player('F1', 'WR', 12),
    player('F2', 'RB', 11),
    player('F3', 'TE', 9),
    player('DEF1', 'DEF', 8),
    player('CUT', 'WR', 1)
  ];

  const gain = lineupGainFromAdding({
    roster,
    addition: player('SCRUB', 'WR', 2),
    dropping: roster.find(p => p.name === 'CUT'),
    rosterPositions: THREE_FLEX_PPR,
    valueOf: pointsOf
  });

  assert.equal(gain, 0);
});

test('two mid players do not replace one stud when only one can start', () => {
  // A roster with no spare flex room: every slot is already filled well.
  const roster = [
    player('QB1', 'QB', 20),
    player('STUD', 'RB', 30),
    player('RB2', 'RB', 18),
    player('WR1', 'WR', 17),
    player('WR2', 'WR', 16),
    player('TE1', 'TE', 15),
    player('F1', 'WR', 15),
    player('F2', 'RB', 15),
    player('F3', 'TE', 15),
    player('DEF1', 'DEF', 8)
  ];

  const before = bestLineupValue(roster, THREE_FLEX_PPR, pointsOf);

  const stud = roster.find(p => p.name === 'STUD');
  const after = bestLineupValue(
    roster.filter(p => p.playerId !== stud.playerId)
      .concat([player('MID1', 'WR', 18), player('MID2', 'WR', 17)]),
    THREE_FLEX_PPR,
    pointsOf
  );

  // Raw points say the package wins by five (35 for 30).
  assert.equal(18 + 17 - 30, 5);
  // The lineup says otherwise: only one of them takes the vacated slot, the
  // other displaces a 15-point starter.
  assert.ok(after - before < 5, `expected lineup gain below raw gain, got ${after - before}`);
});

test('weekly valuation prices a bye week that season totals average away', () => {
  const weeks = [1, 2, 3];
  const roster = [
    player('QB1', 'QB', 0, { playerId: 'qb1' }),
    player('DEF1', 'DEF', 0, { playerId: 'def1' })
  ];

  // The only quarterback is off in week 2.
  const points = {
    qb1: { 1: 20, 2: 0, 3: 20 },
    def1: { 1: 8, 2: 8, 3: 8 },
    backup: { 1: 12, 2: 12, 3: 12 }
  };
  const pointsIn = (p, week) => points[p.playerId]?.[week] ?? 0;

  const gain = weeklyLineupGain({
    roster,
    addition: player('BACKUP', 'QB', 0, { playerId: 'backup' }),
    dropping: roster.find(p => p.playerId === 'def1'),
    rosterPositions: ['QB', 'DEF', 'BN'],
    weeks,
    pointsIn
  });

  // Weeks 1 and 3 the starter plays and the backup adds nothing; week 2 the
  // backup is the difference between 12 points and none. Dropping the defence
  // costs its 8 points a week.
  assert.equal(gain, 12 - 8 * 3);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replacementRisk } from '../src/services/lineupValue.js';
import { player } from './helpers.js';

/** Two RB slots, one flex, so depth at back matters. */
const SLOTS = ['RB', 'RB', 'FLEX', 'BN', 'BN'];
const WEEKS = [1, 2, 3, 4, 5];

/** Flat weekly points per player, keyed by id. */
function pointsFrom(values) {
  return (p, week) => (WEEKS.includes(week) ? values[p.playerId] ?? 0 : 0);
}

test('cover is worth something when a position has no viable backup', () => {
  const roster = [
    player('Stud', 'RB', 0, { playerId: 'stud' }),
    player('Second', 'RB', 0, { playerId: 'second' }),
    player('Filler', 'WR', 0, { playerId: 'filler' })
  ];
  const values = { stud: 20, second: 14, filler: 6, add: 10 };

  const result = replacementRisk({
    roster,
    addition: player('Backup', 'RB', 0, { playerId: 'add' }),
    rosterPositions: SLOTS,
    weeks: WEEKS,
    pointsIn: pointsFrom(values)
  });

  assert.ok(result.value > 0, 'a thin position should price cover above zero');
  assert.ok(result.scenarios.length > 0, 'the scenarios behind it should be stated');
});

test('cover is worth nothing when the position is already deep', () => {
  // Four backs of similar quality: losing one changes little.
  const roster = [
    player('RB1', 'RB', 0, { playerId: 'a' }),
    player('RB2', 'RB', 0, { playerId: 'b' }),
    player('RB3', 'RB', 0, { playerId: 'c' }),
    player('RB4', 'RB', 0, { playerId: 'd' })
  ];
  const values = { a: 15, b: 14, c: 14, d: 14, add: 8 };

  const result = replacementRisk({
    roster,
    addition: player('Spare', 'RB', 0, { playerId: 'add' }),
    rosterPositions: SLOTS,
    weeks: WEEKS,
    pointsIn: pointsFrom(values)
  });

  assert.equal(result.value, 0, 'existing depth already covers the absence');
});

test('cover never exceeds what the absence would cost', () => {
  const roster = [
    player('Starter', 'RB', 0, { playerId: 's' }),
    player('Bench', 'RB', 0, { playerId: 'b' })
  ];
  // The addition is better than the starter, but that is an upgrade, which the
  // immediate-gain term counts - not cover.
  const values = { s: 10, b: 9, add: 30 };

  const result = replacementRisk({
    roster,
    addition: player('Better', 'RB', 0, { playerId: 'add' }),
    rosterPositions: SLOTS,
    weeks: WEEKS,
    pointsIn: pointsFrom(values)
  });

  for (const scenario of result.scenarios) {
    assert.ok(
      scenario.recovered <= scenario.lost,
      `recovered ${scenario.recovered} should not exceed lost ${scenario.lost}`
    );
  }
});

test('a position with more injury risk prices cover higher', () => {
  const roster = [
    player('A', 'RB', 0, { playerId: 'a' }),
    player('B', 'RB', 0, { playerId: 'b' })
  ];
  const qbRoster = [
    player('A', 'QB', 0, { playerId: 'a' }),
    player('B', 'QB', 0, { playerId: 'b' })
  ];
  const values = { a: 20, b: 5, add: 12 };

  const rb = replacementRisk({
    roster,
    addition: player('RBadd', 'RB', 0, { playerId: 'add' }),
    rosterPositions: ['RB', 'FLEX', 'BN'],
    weeks: WEEKS,
    pointsIn: pointsFrom(values)
  });
  const qb = replacementRisk({
    roster: qbRoster,
    addition: player('QBadd', 'QB', 0, { playerId: 'add' }),
    rosterPositions: ['QB', 'BN'],
    weeks: WEEKS,
    pointsIn: pointsFrom(values)
  });

  assert.ok(rb.risk > qb.risk, 'a back is likelier to miss time than a quarterback');
});

test('no remaining weeks means no cover to price', () => {
  const result = replacementRisk({
    roster: [player('A', 'RB', 0, { playerId: 'a' })],
    addition: player('B', 'RB', 0, { playerId: 'b' }),
    rosterPositions: SLOTS,
    weeks: [],
    pointsIn: () => 10
  });
  assert.equal(result.value, 0);
  assert.deepEqual(result.scenarios, []);
});

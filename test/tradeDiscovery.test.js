import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TradeAnalyzer } from '../src/services/tradeAnalyzer.js';
import { THREE_FLEX_PPR, player } from './helpers.js';

/**
 * Discovery only needs roster shape and a value per player, so the analyser is
 * driven directly rather than through the network-backed services.
 */
function analyzerWith(values) {
  const analyzer = new TradeAnalyzer({ hasProjections: () => true });
  analyzer.rosterPositions = THREE_FLEX_PPR;
  analyzer.outlook = {
    players: Object.fromEntries(
      Object.entries(values).map(([id, v]) => [id, { restOfSeason: v, playoff: 0 }])
    )
  };
  return analyzer;
}

/** A full starting lineup plus bench, with ids matching the value map. */
function roster(spec) {
  return spec.map(([id, position, points]) =>
    player(id, position, points, { playerId: id }));
}

test('a swap that helps only one side is not proposed', () => {
  const mine = roster([
    ['m1', 'QB', 25], ['m2', 'RB', 24], ['m3', 'RB', 23], ['m4', 'WR', 22],
    ['m5', 'WR', 21], ['m6', 'TE', 20], ['m7', 'WR', 19], ['m8', 'RB', 18],
    ['m9', 'TE', 17], ['m10', 'DEF', 16], ['m11', 'WR', 2]
  ]);
  // Their roster is uniformly worse: nothing they hold improves your lineup.
  const theirs = roster([
    ['t1', 'QB', 5], ['t2', 'RB', 4], ['t3', 'RB', 4], ['t4', 'WR', 3],
    ['t5', 'WR', 3], ['t6', 'TE', 3], ['t7', 'WR', 2], ['t8', 'RB', 2],
    ['t9', 'TE', 2], ['t10', 'DEF', 2], ['t11', 'WR', 1]
  ]);

  const values = {};
  for (const p of [...mine, ...theirs]) values[p.playerId] = p.realProjection;

  const upgrades = analyzerWith(values).findMutualUpgrades(mine, theirs);
  assert.equal(upgrades.length, 0, 'no deal should be proposed when only one side gains');
});

test('complementary strengths produce a mutual upgrade', () => {
  // You are strong at receiver and weak at running back; they are the reverse.
  const mine = roster([
    ['m1', 'QB', 25], ['m2', 'RB', 6], ['m3', 'RB', 5], ['m4', 'WR', 30],
    ['m5', 'WR', 29], ['m6', 'TE', 20], ['m7', 'WR', 28], ['m8', 'WR', 27],
    ['m9', 'TE', 15], ['m10', 'DEF', 10], ['m11', 'WR', 26]
  ]);
  const theirs = roster([
    ['t1', 'QB', 24], ['t2', 'RB', 30], ['t3', 'RB', 29], ['t4', 'WR', 6],
    ['t5', 'WR', 5], ['t6', 'TE', 19], ['t7', 'RB', 28], ['t8', 'RB', 27],
    ['t9', 'TE', 14], ['t10', 'DEF', 9], ['t11', 'RB', 26]
  ]);

  const values = {};
  for (const p of [...mine, ...theirs]) values[p.playerId] = p.realProjection;

  const upgrades = analyzerWith(values).findMutualUpgrades(mine, theirs);
  assert.ok(upgrades.length > 0, 'complementary rosters should produce a deal');

  for (const upgrade of upgrades) {
    assert.ok(upgrade.myGain > 0, 'your lineup must improve');
    assert.ok(upgrade.theirGain > 0, 'their lineup must improve or they will decline');
  }
});

test('the best available offer comes first', () => {
  const mine = roster([
    ['m1', 'QB', 25], ['m2', 'RB', 6], ['m3', 'RB', 5], ['m4', 'WR', 30],
    ['m5', 'WR', 29], ['m6', 'TE', 20], ['m7', 'WR', 28], ['m8', 'WR', 27],
    ['m9', 'TE', 15], ['m10', 'DEF', 10], ['m11', 'WR', 26]
  ]);
  const theirs = roster([
    ['t1', 'QB', 24], ['t2', 'RB', 30], ['t3', 'RB', 29], ['t4', 'WR', 6],
    ['t5', 'WR', 5], ['t6', 'TE', 19], ['t7', 'RB', 28], ['t8', 'RB', 27],
    ['t9', 'TE', 14], ['t10', 'DEF', 9], ['t11', 'RB', 26]
  ]);
  const values = {};
  for (const p of [...mine, ...theirs]) values[p.playerId] = p.realProjection;

  const upgrades = analyzerWith(values).findMutualUpgrades(mine, theirs);
  for (let i = 1; i < upgrades.length; i++) {
    assert.ok(upgrades[i - 1].myGain >= upgrades[i].myGain, 'sorted by your gain');
  }
});

test('discovery is skipped when the league shape is unknown', () => {
  const analyzer = new TradeAnalyzer({ hasProjections: () => true });
  analyzer.rosterPositions = [];
  assert.deepEqual(analyzer.findMutualUpgrades([], []), []);
});

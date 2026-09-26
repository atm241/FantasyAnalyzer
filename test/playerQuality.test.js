import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankMultiplier, depthMultiplier, playerQuality } from '../src/data/playerQuality.js';

test('fantasy relevance scales the multiplier', () => {
  assert.ok(rankMultiplier(5) > rankMultiplier(100));
  assert.ok(rankMultiplier(100) > rankMultiplier(500));
  // Unranked players sit at replacement level rather than average.
  assert.equal(rankMultiplier(null), rankMultiplier(9999999));
});

test('a backup on the depth chart is discounted', () => {
  assert.equal(depthMultiplier(1, 'RB'), 1);
  assert.ok(depthMultiplier(2, 'RB') < 1);
  assert.ok(depthMultiplier(4, 'RB') < depthMultiplier(2, 'RB'));
});

test('a backup quarterback is discounted far harder than a backup back', () => {
  // Only one quarterback plays; running backs share carries.
  assert.ok(depthMultiplier(2, 'QB') < depthMultiplier(2, 'RB'));
});

test('depth chart position is ignored where it does not apply', () => {
  assert.equal(depthMultiplier(3, 'DEF'), 1);
  assert.equal(depthMultiplier(null, 'RB'), 1);
});

test('a highly ranked player buried on the depth chart is not elite', () => {
  // The case that mattered: a well-known back sitting fourth on his depth
  // chart was being valued as a starter by the old hardcoded name list.
  const buried = playerQuality({ searchRank: 20, depthChartOrder: 4, position: 'RB' });
  const starter = playerQuality({ searchRank: 60, depthChartOrder: 1, position: 'RB' });
  assert.ok(buried < starter, `buried ${buried} should rank below starter ${starter}`);
});

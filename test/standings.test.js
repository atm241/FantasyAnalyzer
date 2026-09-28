import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StandingsAnalyzer } from '../src/services/standings.js';

/** The scoring model needs no network: it reads a record and a strength entry. */
const analyzer = new StandingsAnalyzer({}, {});

const strength = { weekly: { 5: 140, 6: 100 }, average: 130 };

test('with no games played the projection stands alone', () => {
  const record = { wins: 0, losses: 0, ties: 0, pointsFor: 0 };
  assert.equal(analyzer.expectedScore(record, strength, 5), 140);
});

test('a bye-hit week is projected lower than a normal one', () => {
  const record = { wins: 0, losses: 0, ties: 0, pointsFor: 0 };
  const normal = analyzer.expectedScore(record, strength, 5);
  const byeWeek = analyzer.expectedScore(record, strength, 6);
  assert.ok(byeWeek < normal, 'a week missing starters should project lower');
});

test('a two game sample barely moves the forecast', () => {
  // Two blowout wins must not convince the model a team scores 200 a week.
  const record = { wins: 2, losses: 0, ties: 0, pointsFor: 400 };
  const expected = analyzer.expectedScore(record, strength, 5);

  // Weight on history is games/20, so 0.1 here.
  assert.equal(expected, 140 * 0.9 + 200 * 0.1);
  assert.ok(expected < 150, `history should not dominate, got ${expected}`);
});

test('history carries more weight as the season runs, but never dominates', () => {
  const light = analyzer.expectedScore(
    { wins: 2, losses: 0, ties: 0, pointsFor: 400 }, strength, 5
  );
  const heavy = analyzer.expectedScore(
    { wins: 8, losses: 2, ties: 0, pointsFor: 2000 }, strength, 5
  );
  assert.ok(heavy > light, 'more evidence should pull the estimate further');

  // Capped at half, so a projection always retains equal say.
  const extreme = analyzer.expectedScore(
    { wins: 30, losses: 0, ties: 0, pointsFor: 6000 }, strength, 5
  );
  assert.equal(extreme, 140 * 0.5 + 200 * 0.5);
});

test('with no projection available it falls back to scoring history', () => {
  const record = { wins: 2, losses: 0, ties: 0, pointsFor: 300 };
  assert.equal(analyzer.expectedScore(record, null, 5), 150);
  assert.equal(analyzer.expectedScore(record, { average: 0, weekly: {} }, 5), 150);
});

test('an unplayed season with no projection scores nothing rather than throwing', () => {
  const record = { wins: 0, losses: 0, ties: 0, pointsFor: 0 };
  assert.equal(analyzer.expectedScore(record, null, 1), 0);
});

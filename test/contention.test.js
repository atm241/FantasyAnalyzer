import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessContention } from '../src/services/contention.js';

test('strong odds mean play for this season', () => {
  const state = assessContention({
    playoffProbability: 0.9, record: { wins: 6, losses: 2 }, standing: 1, week: 9
  });
  assert.equal(state.stage, 'contending');
  assert.ok(state.faabMultiplier > 1, 'a contender should spend budget');
  assert.equal(state.tradePosture, 'buy');
});

test('a bad start early is not yet a lost season', () => {
  // Week 2 odds mostly reflect roster strength, not results, so a poor record
  // must not push a team into selling.
  const state = assessContention({
    playoffProbability: 0.12, record: { wins: 0, losses: 2 }, standing: 11, week: 2
  });
  assert.equal(state.stage, 'fringe');
  assert.ok(state.reasons.some(r => r.includes('too early')));
});

test('the same odds late in the season mean rebuilding', () => {
  const state = assessContention({
    playoffProbability: 0.04, record: { wins: 1, losses: 9 }, standing: 12, week: 11
  });
  assert.equal(state.stage, 'rebuilding');
  assert.ok(state.faabMultiplier < 1, 'a lost season should bank budget');
  assert.equal(state.tradePosture, 'sell');
});

test('the trade deadline closes trading', () => {
  const before = assessContention({
    playoffProbability: 0.7, record: { wins: 7, losses: 4 }, week: 11, tradeDeadline: 12
  });
  assert.equal(before.tradesAllowed, true);
  assert.equal(before.weeksToDeadline, 1);

  const after = assessContention({
    playoffProbability: 0.7, record: { wins: 8, losses: 5 }, week: 13, tradeDeadline: 12
  });
  assert.equal(after.tradesAllowed, false);
  assert.ok(after.reasons.some(r => r.includes('deadline')));
});

test('confidence grows as the season runs', () => {
  const early = assessContention({ playoffProbability: 0.5, week: 2, playoffStart: 15 });
  const late = assessContention({ playoffProbability: 0.5, week: 13, playoffStart: 15 });
  assert.ok(late.confidence > early.confidence);
  assert.ok(early.confidence >= 0 && late.confidence <= 1);
});

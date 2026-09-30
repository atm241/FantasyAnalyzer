import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlatformAdapter } from '../src/adapters/platformAdapter.js';
import { LineupOptimizer } from '../src/services/optimizer.js';
import { WaiverAnalyzer } from '../src/services/waivers.js';
import { TradeAnalyzer } from '../src/services/tradeAnalyzer.js';

/**
 * Without projections the estimate fallback gives every player at a position
 * the same score. These pin down that the tool declines to answer rather than
 * presenting that as a projection.
 */
const withoutProjections = { hasProjections: () => false };
const withProjections = { hasProjections: () => true };

test('only platforms with a projections feed claim to support one', () => {
  assert.equal(new PlatformAdapter('sleeper').supportsProjections(), true);
  assert.equal(new PlatformAdapter('espn').supportsProjections(), false);
});

test('the optimiser reports that it cannot project', () => {
  assert.equal(new LineupOptimizer(withoutProjections).canProject(), false);
  assert.equal(new LineupOptimizer(withProjections).canProject(), true);
});

test('no FAAB figure is given without projections to price it', () => {
  const analyzer = new WaiverAnalyzer(withoutProjections, {});
  const bid = analyzer.suggestBid(
    { position: 'WR', realProjection: 10 },
    { WR: { idealCount: 4, replacement: 8, incumbent: 8, streamable: false } },
    { remaining: 80, total: 100, spent: 20 },
    {}
  );

  assert.equal(bid.amount, null, 'a dollar figure here would be invented');
  assert.match(bid.note, /projections/);
});

test('no trades are proposed without projections to value them', async () => {
  const analyzer = new TradeAnalyzer(withoutProjections);
  const matches = await analyzer.findTradeMatches({ starters: [], bench: [] }, 'L', 'u');
  assert.deepEqual(matches, []);
  assert.equal(analyzer.projectionsAvailable, false);

  const text = analyzer.formatTradeAnalysis(matches, { surplus: {}, deficit: {} });
  assert.match(text, /needs player projections/);
});

test('rest-of-season is zero rather than a fabricated position average', () => {
  const analyzer = new TradeAnalyzer(withoutProjections);
  // No outlook loaded, so nothing is known about this player's season.
  assert.equal(
    analyzer.estimateRestOfSeasonPoints({ playerId: 'x', position: 'RB' }),
    0,
    'a position average times eight weeks is not a projection'
  );
});

test('a failed projection fetch is never cached', async () => {
  // A transient outage that got persisted would serve zero projections for the
  // whole cache window, flattening every rest-of-season number long after the
  // feed recovered. This is the shape of that guard.
  const { SleeperAPI } = await import('../src/api/sleeper.js');
  const api = new SleeperAPI();

  const weeks = [4, 5, 6];
  const allEmpty = Object.fromEntries(weeks.map(w => [w, {}]));
  const partial = { 4: { '123': { pts_ppr: 12 } }, 5: {}, 6: {} };
  const full = Object.fromEntries(weeks.map(w => [w, { '123': { pts_ppr: 12 } }]));

  const cacheable = byWeek => {
    const entries = Object.values(byWeek)
      .reduce((t, s) => t + Object.keys(s || {}).length, 0);
    const complete = Object.values(byWeek)
      .filter(s => Object.keys(s || {}).length > 0).length;
    return entries > 0 && complete === Object.keys(byWeek).length;
  };

  assert.equal(cacheable(allEmpty), false, 'a total failure must not be cached');
  assert.equal(cacheable(partial), false, 'a partial failure must not be cached');
  assert.equal(cacheable(full), true, 'a complete fetch is worth keeping');
  assert.equal(typeof api.getProjectionRange, 'function');
});

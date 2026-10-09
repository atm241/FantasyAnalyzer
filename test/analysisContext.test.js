import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisContext } from '../src/display/analysisContext.js';

/**
 * The menu exists so a screen's cost is only paid when it is opened. These pin
 * down that the context computes on demand, once, and does not cache failures.
 */
function contextWith(counters) {
  return new AnalysisContext({
    services: {
      rosterService: {
        formatRoster: async () => { counters.formatted++; return { starters: [], bench: [] }; },
        getRosterPositions: async () => [],
        getRestOfSeasonOutlook: async () => ({ players: {}, weeks: [] }),
        getEconomics: async () => ({})
      },
      gameday: { getLiveMatchup: async () => { counters.matchup++; return { week: 1 }; } },
      waiverAnalyzer: {
        getTopAvailable: async () => { counters.board++; return {}; },
        analyzeRosterNeeds: async () => ({ weakPositions: [] })
      },
      buildByeOutlook: () => ({ trouble: [] })
    },
    league: { league_id: 'L' },
    user: { user_id: 'u' },
    roster: {},
    contention: null
  });
}

test('nothing is computed until it is asked for', async () => {
  const counters = { formatted: 0, matchup: 0, board: 0 };
  const context = contextWith(counters);

  assert.equal(counters.board, 0, 'the expensive screen must not run on construction');
  assert.equal(context.has('board'), false);

  await context.get('matchup');
  assert.equal(counters.matchup, 1);
  assert.equal(counters.board, 0, 'opening one screen must not load another');
});

test('a screen is computed once and reused', async () => {
  const counters = { formatted: 0, matchup: 0, board: 0 };
  const context = contextWith(counters);

  await context.get('board');
  await context.get('board');
  await context.get('board');

  assert.equal(counters.board, 1, 'revisiting a screen should cost nothing');
});

test('concurrent requests share one computation', async () => {
  const counters = { formatted: 0, matchup: 0, board: 0 };
  const context = contextWith(counters);

  await Promise.all([context.get('board'), context.get('board')]);
  assert.equal(counters.board, 1);
});

test('a failure is not cached, so a retry can succeed', async () => {
  let attempts = 0;
  const context = new AnalysisContext({
    services: {
      gameday: {
        getLiveMatchup: async () => {
          attempts++;
          if (attempts === 1) throw new Error('transient');
          return { week: 2 };
        }
      }
    },
    league: { league_id: 'L' },
    user: { user_id: 'u' },
    roster: {}
  });

  await assert.rejects(() => context.get('matchup'), /transient/);
  assert.equal(context.has('matchup'), false, 'a failed result must not be kept');

  const result = await context.get('matchup');
  assert.equal(result.week, 2, 'retrying should recompute');
});

test('an unknown screen resolves rather than throwing', async () => {
  const context = contextWith({ formatted: 0, matchup: 0, board: 0 });
  assert.equal(await context.get('nonsense'), null);
});

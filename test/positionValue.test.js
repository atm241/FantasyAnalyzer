import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPositionEconomics } from '../src/services/positionValue.js';
import { THREE_FLEX_PPR, player } from './helpers.js';

/** Available free agents, flat within a position unless stated. */
function pool(position, points) {
  return points.map((p, i) => player(`${position}${i}`, position, p));
}

test('three flex slots land mostly on receivers in a PPR league', () => {
  const economics = buildPositionEconomics({
    rosterPositions: THREE_FLEX_PPR,
    availableByPosition: {
      QB: pool('QB', [18, 17, 17, 16, 16]),
      RB: pool('RB', [8, 7, 6, 6, 5]),
      WR: pool('WR', [9, 9, 8, 8, 8]),
      TE: pool('TE', [7, 6, 6, 5, 5]),
      K: pool('K', [7, 7, 7, 7, 7]),
      DEF: pool('DEF', [9, 8, 7, 7, 7])
    },
    rosteredByPosition: {},
    teams: 12
  });

  assert.ok(
    economics.WR.flexShare > economics.RB.flexShare,
    `receivers should take the larger flex share, got WR ${economics.WR.flexShare} vs RB ${economics.RB.flexShare}`
  );
  assert.equal(economics.WR.dedicatedSlots, 2);
  assert.equal(economics.QB.dedicatedSlots, 1);
});

test('a flat waiver pool marks a position streamable', () => {
  const economics = buildPositionEconomics({
    rosterPositions: THREE_FLEX_PPR,
    availableByPosition: {
      // Every available defence is worth about the same.
      DEF: pool('DEF', [8.9, 8.7, 8.6, 8.5, 8.4]),
      QB: pool('QB', [18, 12, 10, 9, 8])
    },
    rosteredByPosition: { DEF: [player('MyDEF', 'DEF', 8.8)] },
    teams: 12
  });

  assert.equal(economics.DEF.streamable, true);
  assert.equal(economics.DEF.idealCount, 1, 'no reason to stockpile a streamable position');
});

test('a position the league never starts is worth nothing', () => {
  const economics = buildPositionEconomics({
    rosterPositions: THREE_FLEX_PPR, // no kicker slot
    availableByPosition: { K: pool('K', [9, 9, 8, 8, 8]) },
    rosteredByPosition: {},
    teams: 12
  });

  assert.equal(economics.K.idealCount, 0);
  assert.equal(economics.K.priority, 0, 'a kicker cannot be a priority with no kicker slot');
});

test('flex demand is pooled, so a second tight end is not automatically a need', () => {
  const economics = buildPositionEconomics({
    rosterPositions: THREE_FLEX_PPR,
    availableByPosition: {
      TE: pool('TE', [6, 5, 5, 4, 4]),
      WR: pool('WR', [9, 9, 8, 8, 8]),
      RB: pool('RB', [8, 7, 7, 6, 6])
    },
    rosteredByPosition: {
      // One good tight end, plenty of receivers filling the flex slots.
      TE: [player('MyTE', 'TE', 11)],
      WR: [
        player('W1', 'WR', 16), player('W2', 'WR', 14),
        player('W3', 'WR', 12), player('W4', 'WR', 10), player('W5', 'WR', 9)
      ],
      RB: [player('R1', 'RB', 15), player('R2', 'RB', 13)]
    },
    teams: 12
  });

  // The best available tight end is worse than the receiver already holding
  // that flex slot, so adding one changes nothing.
  assert.equal(economics.TE.priority, 0);
});

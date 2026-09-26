import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPlayerName, isEmptySlot, realPlayers } from '../src/utils/playerName.js';

test('a team defence has no full name and must be assembled', () => {
  // Sleeper stores defences as city plus nickname with no full_name, which
  // used to render them as "undefined" on the waiver wire.
  const seahawks = { first_name: 'Seattle', last_name: 'Seahawks', position: 'DEF' };
  assert.equal(getPlayerName(seahawks), 'Seattle Seahawks');
});

test('an ordinary player uses their full name', () => {
  assert.equal(getPlayerName({ full_name: 'Derrick Henry' }), 'Derrick Henry');
});

test('a missing player falls back rather than throwing', () => {
  assert.equal(getPlayerName(null), 'Unknown');
  assert.equal(getPlayerName(undefined, 'Unknown Player'), 'Unknown Player');
});

test('an unfilled starting slot is recognised', () => {
  // Sleeper uses "0" for a slot nobody was started in.
  assert.equal(isEmptySlot('0'), true);
  assert.equal(isEmptySlot(0), true);
  assert.equal(isEmptySlot(null), true);
  assert.equal(isEmptySlot(''), true);
  assert.equal(isEmptySlot('4034'), false);
});

test('empty slots are excluded from player lists', () => {
  const entries = [
    { playerId: '1', name: 'Real' },
    { playerId: null, name: '(empty RB slot)', emptySlot: true },
    { playerId: '2', name: 'Also real' }
  ];
  assert.deepEqual(realPlayers(entries).map(p => p.name), ['Real', 'Also real']);
});

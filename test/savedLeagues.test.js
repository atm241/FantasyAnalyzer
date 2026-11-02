import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRenewedLeague } from '../src/utils/savedLeagues.js';

const lastSeason = { league_id: 'old', name: 'Chill League', season: '2026' };

test('a renewed league is found through its link to last season', () => {
  // Sleeper issues a new id on renewal, so a saved id would otherwise keep
  // loading the finished season.
  const leagues = [
    { league_id: 'other', name: 'Work League' },
    { league_id: 'new', name: 'Chill League (2027)', previous_league_id: 'old' }
  ];
  assert.equal(findRenewedLeague(lastSeason, leagues).league_id, 'new');
});

test('without a link, a single league of the same name is taken', () => {
  const leagues = [{ league_id: 'new', name: 'Chill League' }];
  assert.equal(findRenewedLeague(lastSeason, leagues).league_id, 'new');
});

test('two leagues of the same name are never guessed between', () => {
  const leagues = [
    { league_id: 'a', name: 'Chill League' },
    { league_id: 'b', name: 'Chill League' }
  ];
  assert.equal(findRenewedLeague(lastSeason, leagues), null);
});

test('a league that was not renewed stays unmatched', () => {
  assert.equal(findRenewedLeague(lastSeason, [{ league_id: 'x', name: 'Other' }]), null);
  assert.equal(findRenewedLeague(lastSeason, []), null);
});

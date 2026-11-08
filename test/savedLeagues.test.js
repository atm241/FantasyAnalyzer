import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRenewedLeague, matchEspnTeam, describeLeague } from '../src/utils/savedLeagues.js';

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

// --- remembering your ESPN team ---

const espnUsers = [
  { user_id: '{A}', display_name: 'alex', metadata: { team_name: 'Crime Scene' } },
  { user_id: '{B}', display_name: 'sam', metadata: { team_name: 'Winner Winner Chicken Dinner' } },
  { user_id: '{C}', display_name: 'jo', metadata: { team_name: 'Chicken Little' } }
];

test('the saved team is found by owner id even after a rename', () => {
  const match = matchEspnTeam(espnUsers, { name: 'Old Team Name', savedOwnerId: '{B}' });
  assert.equal(match.user_id, '{B}');
});

test('a team typed out in full beats the saved one', () => {
  const match = matchEspnTeam(espnUsers, { name: 'chicken little', savedOwnerId: '{B}' });
  assert.equal(match.user_id, '{C}');
});

test('without a saved team, part of a team or owner name still matches', () => {
  assert.equal(matchEspnTeam(espnUsers, { name: 'crime' }).user_id, '{A}');
  assert.equal(matchEspnTeam(espnUsers, { name: 'sam' }).user_id, '{B}');
});

test('an empty name never matches the first team by accident', () => {
  // Every string contains '', which used to pick team 1 silently.
  assert.equal(matchEspnTeam(espnUsers, { name: '' }), null);
  assert.equal(matchEspnTeam(espnUsers, { name: '  ' }), null);
});

test('a saved owner who has left the league falls back to the name', () => {
  assert.equal(matchEspnTeam(espnUsers, { name: 'crime', savedOwnerId: '{Z}' }).user_id, '{A}');
  assert.equal(matchEspnTeam(espnUsers, { savedOwnerId: '{Z}' }), null);
});

test('the saved list shows the ESPN team alongside the league', () => {
  const label = describeLeague({ platform: 'espn', name: 'My League', teamName: 'Crime Scene' });
  assert.equal(label, 'My League (ESPN - Crime Scene)');
});

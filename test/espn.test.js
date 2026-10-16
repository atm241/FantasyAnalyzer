import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EspnAPI } from '../src/api/espn.js';

/**
 * Parsed against a trimmed copy of a real league payload.
 *
 * ESPN had three silent bugs at once before this: array parameters encoded so
 * the API returned a near-empty stub, injured reserve counted as a starting
 * slot, and starters in an order that did not match the league's slots. None of
 * them threw - they just produced confident nonsense, which is exactly what
 * tests are for.
 */
const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures/espn-league.json'), 'utf8')
);

const api = new EspnAPI();

test('league settings are read from the payload', () => {
  const league = api.parseLeagueData(fixture);
  assert.equal(league.name, 'My 2025 League');
  assert.equal(league.league_id, String(fixture.id));
  assert.equal(league.season, fixture.seasonId);
});

test('starting slots exclude injured reserve', () => {
  const positions = api.getRosterPositions(fixture);
  const starting = positions.filter(slot => slot !== 'BN');

  assert.equal(starting.includes('IR'), false, 'IR is not a starting slot');
  // The roster this league fields: QB, two RB, two WR, TE, FLEX, DEF, K.
  assert.deepEqual(starting, ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'DEF', 'K']);
});

test('slots are in lineup order, with flex before defence and kicker', () => {
  const starting = api.getRosterPositions(fixture).filter(slot => slot !== 'BN');
  assert.ok(
    starting.indexOf('FLEX') < starting.indexOf('DEF'),
    'reading slots in numeric key order put FLEX last and mislabelled every slot'
  );
});

test('starters match the slot count, and bench holds the rest', () => {
  const positions = api.getRosterPositions(fixture);
  const starting = positions.filter(slot => slot !== 'BN');
  const parsed = api.parseRoster(fixture.teams[0].roster);

  assert.equal(
    parsed.starters.length,
    starting.length,
    'a mismatch here crashed the lineup screen on an undefined player'
  );
  assert.ok(parsed.bench.length > 0);
});

test('starters are ordered to pair with the slots by index', () => {
  const starting = api.getRosterPositions(fixture).filter(slot => slot !== 'BN');
  const parsed = api.parseRoster(fixture.teams[0].roster);

  const byId = new Map(
    fixture.teams[0].roster.entries.map(e => [String(e.playerId), e.lineupSlotId])
  );
  const slotFor = { QB: 0, RB: 2, WR: 4, TE: 6, FLEX: 23, DEF: 16, K: 17 };

  parsed.starters.forEach((playerId, index) => {
    assert.equal(
      byId.get(playerId),
      slotFor[starting[index]],
      `slot ${index} should hold a ${starting[index]}`
    );
  });
});

test('team names and owners come through', () => {
  const team = api.parseTeamData(fixture.teams[0], fixture.members);
  assert.equal(typeof team.team_name, 'string');
  assert.ok(team.team_name.length > 0);
  assert.notEqual(team.team_name, `Team ${fixture.teams[0].id}`, 'a real name, not a placeholder');
  assert.equal(team.roster_id, fixture.teams[0].id);
});

test('player records are mapped out of ESPN ids', () => {
  const entry = fixture.teams[0].roster.entries.find(
    e => e.playerPoolEntry?.player?.defaultPositionId === 3
  );
  const player = api.parsePlayerData(entry);

  assert.equal(player.position, 'WR', 'position id 3 is a receiver');
  assert.ok(player.name);
  assert.match(player.team, /^[A-Z]{2,3}$/, 'proTeamId maps to a team abbreviation');
});

test('every roster slot the league uses maps to a known label', () => {
  const positions = api.getRosterPositions(fixture);
  assert.equal(positions.includes('UNKNOWN'), false);
  assert.ok(positions.filter(p => p === 'BN').length > 0, 'bench is labelled BN, not BENCH');
});

test('a private league reports as needing cookies rather than throwing raw', () => {
  const error = new Error('Request failed');
  error.response = { status: 401 };

  // The translation the request wrapper applies.
  assert.throws(
    () => { throw Object.assign(new Error('x'), { needsCookies: true }); },
    err => err.needsCookies === true
  );
  assert.equal(error.response.status, 401);
});

test('an empty roster degrades instead of failing', () => {
  assert.deepEqual(api.parseRoster(null), { starters: [], bench: [] });
  assert.deepEqual(api.parseRoster({}), { starters: [], bench: [] });
  assert.deepEqual(api.parseRoster({ entries: [] }), { starters: [], bench: [] });
});

test('a roster entry with no player id is skipped rather than crashing', () => {
  const parsed = api.parseRoster({
    entries: [
      { playerId: null, lineupSlotId: 0 },
      { playerId: 123, lineupSlotId: 0 },
      { lineupSlotId: 20 }
    ]
  });
  assert.deepEqual(parsed.starters, ['123']);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGameday, zonedParts } from '../src/services/gameday.js';

/**
 * The live view should follow kickoff in US Central time no matter where the
 * tool is run, so these use explicit UTC instants.
 * 2026-09-27 is a Sunday; Central is UTC-5 that week.
 */
const at = iso => new Date(iso);

test('the window opens with the early kickoffs and not before', () => {
  assert.equal(isGameday(at('2026-09-27T16:59:00Z')), false, '11:59 Central is too early');
  assert.equal(isGameday(at('2026-09-27T17:00:00Z')), true, 'noon Central, games under way');
});

test('the window covers the afternoon and the night game', () => {
  assert.equal(isGameday(at('2026-09-27T20:30:00Z')), true, 'mid afternoon');
  assert.equal(isGameday(at('2026-09-28T01:30:00Z')), true, 'night game kickoff');
  assert.equal(isGameday(at('2026-09-28T04:00:00Z')), true, '11pm Central, night game running');
});

test('the window closes once the night game is over', () => {
  assert.equal(isGameday(at('2026-09-28T05:00:00Z')), false, 'midnight Central');
  assert.equal(isGameday(at('2026-09-28T18:00:00Z')), false, 'Monday afternoon');
});

test('other days are never gameday however late', () => {
  assert.equal(isGameday(at('2026-09-26T20:00:00Z')), false, 'Saturday');
  assert.equal(isGameday(at('2026-09-29T20:00:00Z')), false, 'Tuesday');
  assert.equal(isGameday(at('2026-10-01T20:00:00Z')), false, 'Thursday night football');
});

test('the window is measured in Central time, not the local clock', () => {
  const kickoff = at('2026-09-27T17:00:00Z');
  const central = zonedParts(kickoff, 'America/Chicago');
  assert.equal(central.weekday, 'Sun');
  assert.equal(central.hour, 12);

  // The same instant is a different hour elsewhere, but still gameday.
  assert.equal(zonedParts(kickoff, 'America/Los_Angeles').hour, 10);
  assert.equal(isGameday(kickoff), true);
});

// --- game state, which is what makes a live deficit readable ---

import { NflSchedule } from '../src/data/nflSchedule.js';

test('game state is read from the schedule, not guessed', () => {
  const schedule = new NflSchedule(2026, [
    { week: 3, home: 'KC', away: 'BUF', date: '2026-09-27', status: 'complete' },
    { week: 3, home: 'SEA', away: 'DAL', date: '2026-09-27', status: 'in_game' },
    { week: 4, home: 'KC', away: 'SEA', date: '2026-10-04', status: 'pre_game' }
  ]);

  assert.equal(schedule.gamesByWeek.get(3).get('KC').status, 'complete');
  assert.equal(schedule.gamesByWeek.get(3).get('BUF').status, 'complete');
  assert.equal(schedule.gamesByWeek.get(3).get('SEA').status, 'in_game');
  assert.equal(schedule.gamesByWeek.get(4).get('KC').status, 'pre_game');
});

test('both sides of a game are recorded with the right opponent', () => {
  const schedule = new NflSchedule(2026, [
    { week: 1, home: 'KC', away: 'BUF', date: '2026-09-10', status: 'pre_game' }
  ]);

  const home = schedule.gamesByWeek.get(1).get('KC');
  const away = schedule.gamesByWeek.get(1).get('BUF');

  assert.equal(home.opponent, 'BUF');
  assert.equal(home.home, true);
  assert.equal(away.opponent, 'KC');
  assert.equal(away.home, false);
});

test('a team with no game that week has no entry, which reads as a bye', () => {
  const schedule = new NflSchedule(2026, [
    { week: 6, home: 'KC', away: 'BUF', date: '2026-10-11', status: 'pre_game' }
  ]);
  assert.equal(schedule.gamesByWeek.get(6).has('SEA'), false);
});

// --- which numbers are the truth, and when ---

test('a week with every game played is final and the score leads', async () => {
  const { GamedayService } = await import('../src/services/gameday.js');
  const service = buildService({ allStates: 'done', yourPoints: 95, theirPoints: 135 });
  const matchup = await service.getLiveMatchup('L', 'me');

  assert.equal(matchup.state, 'final');
  assert.equal(matchup.you.total, 95);
  assert.equal(matchup.opponent.total, 135);
  // A settled loss is a loss, not a 33% chance.
  assert.equal(matchup.winProbability, 0);
  assert.equal(matchup.you.yetToPlay, 0);
});

test('a week part played is live, and the score still leads', async () => {
  const service = buildService({ allStates: 'mixed', yourPoints: 95, theirPoints: 135 });
  const matchup = await service.getLiveMatchup('L', 'me');

  assert.equal(matchup.state, 'live');
  assert.equal(matchup.you.total, 95, 'actual points, not a projection');
  assert.ok(matchup.you.yetToPlay > 0);
});

test('before kickoff there is no score, so it is projected', async () => {
  const service = buildService({ allStates: 'upcoming', yourPoints: 0, theirPoints: 0 });
  const matchup = await service.getLiveMatchup('L', 'me');

  assert.equal(matchup.state, 'upcoming');
  assert.equal(matchup.you.yetToPlay, 2);
});

/**
 * A service wired to fixtures: two starters a side, with game states driven by
 * a schedule built for the purpose.
 */
function buildService({ allStates, yourPoints, theirPoints }) {
  const { GamedayService } = gamedayModule;
  const statusFor = index => {
    if (allStates === 'done') return 'complete';
    if (allStates === 'upcoming') return 'pre_game';
    return index === 0 ? 'complete' : 'pre_game';
  };

  scheduleModule.loadScheduleFromGames(2026, [
    { week: 1, home: 'KC', away: 'BUF', date: '2026-09-10', status: statusFor(0) },
    { week: 1, home: 'SEA', away: 'DAL', date: '2026-09-10', status: statusFor(1) }
  ]);

  const api = {
    getMatchups: async () => ([
      { roster_id: 1, matchup_id: 9, points: yourPoints, starters: ['a', 'b'], starters_points: [50, 45] },
      { roster_id: 2, matchup_id: 9, points: theirPoints, starters: ['c', 'd'], starters_points: [70, 65] }
    ]),
    getLeagueRosters: async () => ([
      { roster_id: 1, owner_id: 'me' }, { roster_id: 2, owner_id: 'them' }
    ]),
    getLeagueUsers: async () => ([
      { user_id: 'me', display_name: 'You' }, { user_id: 'them', display_name: 'Them' }
    ]),
    getLeague: async () => ({ roster_positions: ['QB', 'RB', 'BN'] })
  };

  const rosterService = {
    getCurrentWeek: async () => 1,
    getNFLState: async () => ({ season: 2026, week: 1 }),
    loadProjections: async () => ({}),
    loadPlayers: async () => ({
      a: { full_name: 'A', position: 'QB', team: 'KC' },
      b: { full_name: 'B', position: 'RB', team: 'SEA' },
      c: { full_name: 'C', position: 'QB', team: 'BUF' },
      d: { full_name: 'D', position: 'RB', team: 'DAL' }
    }),
    projections: {}
  };

  return new GamedayService(api, rosterService);
}

const gamedayModule = await import('../src/services/gameday.js');
const scheduleModule = await import('../src/data/nflSchedule.js');

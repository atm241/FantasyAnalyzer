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

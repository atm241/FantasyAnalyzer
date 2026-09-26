import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NflSchedule, getCurrentSeasonYear } from '../src/data/nflSchedule.js';
import { scheduleFixture } from './helpers.js';

const TEAMS = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN',
  'DET', 'GB', 'HOU', 'IND', 'JAX', 'KC', 'LAC', 'LAR', 'LV', 'MIA',
  'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SEA', 'SF', 'TB', 'TEN', 'WAS'
];

test('a season is labelled by the year it kicks off in', () => {
  assert.equal(getCurrentSeasonYear(new Date('2026-09-15T12:00:00')), 2026);
  assert.equal(getCurrentSeasonYear(new Date('2026-12-25T12:00:00')), 2026);
  // January belongs to the season that started the previous autumn.
  assert.equal(getCurrentSeasonYear(new Date('2027-01-10T12:00:00')), 2026);
  assert.equal(getCurrentSeasonYear(new Date('2027-07-01T12:00:00')), 2026);
  assert.equal(getCurrentSeasonYear(new Date('2027-08-15T12:00:00')), 2027);
});

test('bye weeks are derived from teams missing that week', () => {
  const byes = { KC: 6, BUF: 6, DAL: 9 };
  const schedule = new NflSchedule(2026, scheduleFixture({ teams: TEAMS, weeks: 18, byes }));

  assert.equal(schedule.byeWeeksByTeam.get('KC')?.[0], 6);
  assert.equal(schedule.byeWeeksByTeam.get('BUF')?.[0], 6);
  assert.equal(schedule.byeWeeksByTeam.get('DAL')?.[0], 9);
  assert.deepEqual(schedule.teamsOnByeByWeek.get(6), ['BUF', 'KC']);
  assert.equal(schedule.teamsOnByeByWeek.has(7), false);
});

test('a complete schedule passes validation', () => {
  const schedule = new NflSchedule(2026, scheduleFixture({
    teams: TEAMS, weeks: 18, byes: Object.fromEntries(TEAMS.map((t, i) => [t, 5 + (i % 10)]))
  }));
  assert.deepEqual(schedule.validate(), []);
});

test('a short schedule is reported rather than trusted', () => {
  const schedule = new NflSchedule(2026, scheduleFixture({
    teams: TEAMS.slice(0, 8), weeks: 4
  }));
  const problems = schedule.validate();
  assert.ok(problems.length > 0);
  assert.ok(problems.some(p => p.includes('teams')));
});

test('the current week does not roll over during Monday night football', () => {
  // Week 1 runs Thu 10 Sept to Mon 14 Sept 2026.
  const schedule = new NflSchedule(2026, scheduleFixture({ teams: TEAMS, weeks: 18 }));
  assert.equal(schedule.lastDateByWeek.get(1), '2026-09-13');

  // 9pm on the final day of the week is still that week, not the next one.
  // Reading the date in UTC used to push this into Tuesday and advance a week
  // while the last game was still being played.
  const mondayNight = new Date(2026, 8, 13, 21, 0, 0);
  assert.equal(schedule.currentWeek(mondayNight), 1);

  // The following morning has moved on.
  assert.equal(schedule.currentWeek(new Date(2026, 8, 14, 9, 0, 0)), 2);
});

test('weeks advance the day after the last game', () => {
  const schedule = new NflSchedule(2026, scheduleFixture({ teams: TEAMS, weeks: 18 }));
  const onDay = (month, day) => schedule.currentWeek(new Date(2026, month, day, 12, 0, 0));

  assert.equal(onDay(8, 10), 1);  // Thursday of week 1
  assert.equal(onDay(8, 13), 1);  // last day of week 1
  assert.equal(onDay(8, 14), 2);  // first day of week 2
  assert.equal(onDay(8, 20), 2);
});

test('a season with no games falls back rather than throwing', () => {
  const schedule = new NflSchedule(2099, []);
  assert.equal(schedule.degraded, true);
  // The Thursday after Labor Day, derived not hardcoded.
  assert.equal(schedule.seasonStart, '2099-09-10');
  assert.equal(typeof schedule.currentWeek(new Date(2099, 9, 1)), 'number');
});

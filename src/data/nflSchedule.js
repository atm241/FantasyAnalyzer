import axios from 'axios';

/**
 * NFL calendar, derived at runtime from the live league schedule.
 *
 * Nothing in this module is hardcoded to a particular season. Bye weeks, the
 * season start, and the current week are all derived from the schedule feed, so
 * the tool rolls over to a new NFL season on its own.
 */

const SCHEDULE_URL = 'https://api.sleeper.app/schedule/nfl/regular';
const EXPECTED_TEAMS = 32;
const EXPECTED_WEEKS = 18;

/** season (number) -> NflSchedule */
const cache = new Map();

/** Most recently loaded schedule, used by the synchronous lookup helpers. */
let active = null;

/** Seasons we have already warned about, so a failure is reported once. */
const warned = new Set();

/**
 * The NFL season a date belongs to. Seasons are labelled by the calendar year
 * they kick off in, so January through July still belong to the previous one.
 */
export function getCurrentSeasonYear(now = new Date()) {
  const year = now.getFullYear();
  return now.getMonth() < 7 ? year - 1 : year;
}

/**
 * The Thursday after Labor Day - the rule the NFL schedules week 1 by. Used
 * only to keep the tool usable if the schedule feed is unreachable.
 */
function estimatedSeasonStart(season) {
  const sept = new Date(Date.UTC(season, 8, 1));
  // Labor Day is the first Monday in September.
  const laborDay = 1 + ((8 - sept.getUTCDay()) % 7);
  return new Date(Date.UTC(season, 8, laborDay + 3));
}

function toDateKey(date) {
  return date.toISOString().slice(0, 10);
}

class NflSchedule {
  constructor(season, games) {
    this.season = season;
    this.byeWeeksByTeam = new Map();
    this.teamsOnByeByWeek = new Map();
    this.firstDateByWeek = new Map();
    this.lastDateByWeek = new Map();
    this.degraded = games.length === 0;

    const teams = new Set();
    const teamsByWeek = new Map();

    for (const game of games) {
      if (!game?.week || !game.home || !game.away) continue;
      teams.add(game.home);
      teams.add(game.away);

      if (!teamsByWeek.has(game.week)) teamsByWeek.set(game.week, new Set());
      teamsByWeek.get(game.week).add(game.home);
      teamsByWeek.get(game.week).add(game.away);

      if (!game.date) continue;
      const first = this.firstDateByWeek.get(game.week);
      const last = this.lastDateByWeek.get(game.week);
      // Dates are ISO (YYYY-MM-DD), so string comparison is chronological.
      if (!first || game.date < first) this.firstDateByWeek.set(game.week, game.date);
      if (!last || game.date > last) this.lastDateByWeek.set(game.week, game.date);
    }

    this.teams = teams;
    this.weeks = [...teamsByWeek.keys()].sort((a, b) => a - b);

    // A team missing from a week's games is on bye that week.
    for (const week of this.weeks) {
      const playing = teamsByWeek.get(week);
      const onBye = [...teams].filter(team => !playing.has(team)).sort();
      if (onBye.length > 0) this.teamsOnByeByWeek.set(week, onBye);
      for (const team of onBye) {
        if (!this.byeWeeksByTeam.has(team)) this.byeWeeksByTeam.set(team, []);
        this.byeWeeksByTeam.get(team).push(week);
      }
    }
  }

  /** Sanity checks, so a malformed feed is loud rather than silently wrong. */
  validate() {
    const problems = [];
    if (this.teams.size !== EXPECTED_TEAMS) {
      problems.push(`expected ${EXPECTED_TEAMS} teams, found ${this.teams.size}`);
    }
    if (this.weeks.length !== EXPECTED_WEEKS) {
      problems.push(`expected ${EXPECTED_WEEKS} weeks, found ${this.weeks.length}`);
    }
    const missingBye = [...this.teams].filter(team => !this.byeWeeksByTeam.has(team));
    if (missingBye.length > 0) {
      problems.push(`no bye week derived for ${missingBye.sort().join(', ')}`);
    }
    return problems;
  }

  get seasonStart() {
    return this.firstDateByWeek.get(this.weeks[0]) || toDateKey(estimatedSeasonStart(this.season));
  }

  /**
   * The week to analyse: the earliest week that has not finished yet. Once a
   * week's last game is behind us the next week becomes the planning target.
   */
  currentWeek(now = new Date()) {
    const today = toDateKey(now);
    if (this.degraded) {
      const start = estimatedSeasonStart(this.season);
      if (now < start) return 1;
      const elapsed = Math.floor((now - start) / (7 * 24 * 60 * 60 * 1000));
      return Math.min(elapsed + 1, EXPECTED_WEEKS);
    }
    for (const week of this.weeks) {
      const last = this.lastDateByWeek.get(week);
      if (!last || today <= last) return week;
    }
    return this.weeks[this.weeks.length - 1];
  }

  seasonType(now = new Date()) {
    return toDateKey(now) < this.seasonStart ? 'pre' : 'regular';
  }
}

async function fetchGames(season) {
  const { data } = await axios.get(`${SCHEDULE_URL}/${season}`, { timeout: 10000 });
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('schedule feed returned no games');
  }
  return data;
}

/**
 * Load (and cache) a season's schedule. Never throws: if the feed is
 * unreachable the tool keeps working on estimated dates, with a visible warning
 * so bye-week gaps are not mistaken for "nobody is on bye".
 */
export async function loadSchedule(season = getCurrentSeasonYear()) {
  const year = Number(season);
  if (cache.has(year)) {
    active = cache.get(year);
    return active;
  }

  let schedule;
  try {
    schedule = new NflSchedule(year, await fetchGames(year));
    const problems = schedule.validate();
    if (problems.length > 0 && !warned.has(year)) {
      warned.add(year);
      console.warn(`⚠️  ${year} NFL schedule looks incomplete: ${problems.join('; ')}`);
    }
  } catch (error) {
    schedule = new NflSchedule(year, []);
    if (!warned.has(year)) {
      warned.add(year);
      console.warn(
        `⚠️  Could not load the ${year} NFL schedule (${error.message}). ` +
        'Weeks are estimated and BYE weeks are unavailable.'
      );
    }
  }

  cache.set(year, schedule);
  active = schedule;
  return schedule;
}

/** True only when the schedule is loaded and the team is genuinely on bye. */
export function isOnBye(team, week) {
  if (!team || !week || !active) return false;
  return (active.byeWeeksByTeam.get(team) || []).includes(week);
}

export function getByeWeek(team) {
  if (!team || !active) return null;
  return active.byeWeeksByTeam.get(team)?.[0] ?? null;
}

/** Teams on bye in a given week, for schedule-aware advice. */
export function getTeamsOnBye(week) {
  if (!week || !active) return [];
  return active.teamsOnByeByWeek.get(week) || [];
}

/** True when bye data is actually available (vs. the degraded fallback). */
export function hasByeData() {
  return Boolean(active) && active.byeWeeksByTeam.size > 0;
}

export { NflSchedule };

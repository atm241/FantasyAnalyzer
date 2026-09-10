#!/usr/bin/env node
/**
 * Guards against the season data going stale.
 *
 * Run at the start of a season (or in CI) to catch the failure mode this
 * project already hit once: hardcoded 2025 dates, bye weeks and season
 * defaults silently producing wrong advice a year later.
 */

import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import axios from 'axios';
import {
  loadSchedule,
  getCurrentSeasonYear,
  getTeamsOnBye
} from '../src/data/nflSchedule.js';

const problems = [];
const notes = [];

/** Files allowed to mention a literal year (they explain why). */
const YEAR_ALLOWLIST = new Set(['scripts/check-freshness.js']);

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

// 1. No hardcoded season years anywhere in src/.
for (const file of walk('src')) {
  if (YEAR_ALLOWLIST.has(file)) continue;
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const match = line.match(/\b20[2-9]\d\b/);
    if (match) {
      problems.push(`${file}:${i + 1} hardcodes the year ${match[0]} - derive it instead: ${line.trim()}`);
    }
  });
}

// 2. The live schedule must load and look like a real NFL season.
const season = getCurrentSeasonYear();
const schedule = await loadSchedule(season);

if (schedule.degraded) {
  problems.push(`Could not load the ${season} NFL schedule - bye weeks would be unavailable.`);
} else {
  const invalid = schedule.validate();
  if (invalid.length > 0) {
    problems.push(`${season} schedule failed validation: ${invalid.join('; ')}`);
  }
  notes.push(`${season} schedule: ${schedule.teams.size} teams, ${schedule.weeks.length} weeks, starts ${schedule.seasonStart}`);
  notes.push(`Derived current week: ${schedule.currentWeek()} (${schedule.seasonType()})`);

  const byeWeeks = schedule.weeks.filter(w => getTeamsOnBye(w).length > 0);
  notes.push(`Bye weeks derived: ${byeWeeks.join(', ')}`);
}

// 3. Cross-check the derived week against Sleeper's own season state.
try {
  const { data } = await axios.get('https://api.sleeper.app/v1/state/nfl', { timeout: 10000 });
  if (String(data.season) !== String(season)) {
    problems.push(`Season mismatch: derived ${season}, Sleeper reports ${data.season}.`);
  }
  if (!schedule.degraded && Math.abs(data.week - schedule.currentWeek()) > 1) {
    problems.push(`Week mismatch: derived ${schedule.currentWeek()}, Sleeper reports ${data.week}.`);
  } else if (!schedule.degraded) {
    notes.push(`Sleeper season state agrees: week ${data.week} of ${data.season}`);
  }
} catch (error) {
  notes.push(`Could not cross-check against Sleeper season state (${error.message})`);
}

// 4. Subjective tiers can't be derived - warn when they predate this season.
try {
  const lastTouched = execSync('git log -1 --format=%aI -- src/data/teamRankings.js', { encoding: 'utf8' }).trim();
  if (lastTouched) {
    const touchedSeason = getCurrentSeasonYear(new Date(lastTouched));
    if (touchedSeason < season) {
      problems.push(
        `src/data/teamRankings.js was last updated for the ${touchedSeason} season ` +
        `(${lastTouched.slice(0, 10)}) - these tiers are hand-maintained and need a review for ${season}.`
      );
    } else {
      notes.push(`teamRankings.js reviewed for the ${touchedSeason} season`);
    }
  }
} catch {
  notes.push('Could not read git history for teamRankings.js');
}

for (const note of notes) console.log(`  ${note}`);

if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} freshness problem(s):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('\n✓ Season data is current.');

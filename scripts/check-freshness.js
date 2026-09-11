#!/usr/bin/env node
/**
 * Guards against the season data going stale.
 *
 * Run at the start of a season (or in CI) to catch the failure mode this
 * project already hit once: hardcoded 2025 dates, bye weeks and season
 * defaults silently producing wrong advice a year later.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import axios from 'axios';
import {
  loadSchedule,
  getCurrentSeasonYear,
  getTeamsOnBye
} from '../src/data/nflSchedule.js';
import {
  loadTeamRankings,
  getRankingsSeason,
  getRankedOffenses,
  isEliteOffense,
  isWeakOffense
} from '../src/data/teamRankings.js';

const problems = [];
const notes = [];

/** Resolve against the repo, so the check works from any directory. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

// 1. No hardcoded season years in executable code under src/.
// Comments may reference a year (explaining history), so only code is scanned.
function stripComments(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*')) return '';
  return line.split('//')[0];
}

for (const file of walk(join(REPO_ROOT, 'src'))) {
  readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
    const match = stripComments(line).match(/\b20[2-9]\d\b/);
    if (match) {
      const relative = file.slice(REPO_ROOT.length + 1);
      problems.push(`${relative}:${i + 1} hardcodes the year ${match[0]} - derive it instead: ${line.trim()}`);
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

// 4. Offensive tiers must derive from real scoring data.
await loadTeamRankings(season);
const rankingsSeason = getRankingsSeason();
const ranked = getRankedOffenses();

if (!rankingsSeason || ranked.length === 0) {
  problems.push('Could not derive offensive tiers - every team would be projected as average.');
} else {
  if (ranked.length !== 32) {
    problems.push(`Offensive tiers cover ${ranked.length} teams, expected 32.`);
  }
  if (season - rankingsSeason > 1) {
    problems.push(`Offensive tiers derive from ${rankingsSeason}, which is more than a season behind ${season}.`);
  }
  const elite = ranked.filter(t => isEliteOffense(t.team)).map(t => t.team);
  const weak = ranked.filter(t => isWeakOffense(t.team)).map(t => t.team);
  const overlap = elite.filter(t => weak.includes(t));
  if (overlap.length > 0) {
    problems.push(`Teams ranked both elite and weak: ${overlap.join(', ')}`);
  }
  notes.push(`Offensive tiers from ${rankingsSeason} scoring (${ranked.length} teams)`);
  notes.push(`  elite: ${elite.join(', ')}`);
  notes.push(`  weak:  ${weak.join(', ')}`);
}

for (const note of notes) console.log(`  ${note}`);

if (problems.length > 0) {
  console.error(`\n✗ ${problems.length} freshness problem(s):\n`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}

console.log('\n✓ Season data is current.');

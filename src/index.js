#!/usr/bin/env node

import { program } from 'commander';
import { SleeperAPI } from './api/sleeper.js';
import { RosterService } from './services/roster.js';
import { LineupOptimizer } from './services/optimizer.js';
import { WaiverAnalyzer } from './services/waivers.js';
import { AISummaryService } from './services/aiSummary.js';
import { FirstToGoAnalyzer } from './services/firstToGo.js';
import { StandingsAnalyzer } from './services/standings.js';
import { DisplayFormatter } from './display/formatter.js';
import readline from 'readline';

const api = new SleeperAPI();
const rosterService = new RosterService(api);
const optimizer = new LineupOptimizer(rosterService);
const waiverAnalyzer = new WaiverAnalyzer(rosterService, api);
const aiSummary = new AISummaryService(rosterService);
const firstToGo = new FirstToGoAnalyzer(rosterService);
const standings = new StandingsAnalyzer(api, rosterService);
const display = new DisplayFormatter();

/**
 * Prompt user for input
 */
function prompt(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise(resolve => {
    rl.question(question, answer => {
      rl.close();
      resolve(answer);
    });
  });
}

/**
 * Interactive league selection
 */
async function selectLeague(username) {
  try {
    const user = await api.getUser(username);

    // Try current season and previous seasons
    const currentYear = new Date().getFullYear();
    const seasons = [currentYear.toString(), (currentYear - 1).toString()];

    let allLeagues = [];
    for (const season of seasons) {
      try {
        const leagues = await api.getUserLeagues(user.user_id, season);
        if (leagues && leagues.length > 0) {
          allLeagues = allLeagues.concat(leagues);
        }
      } catch (err) {
        // Continue to next season
      }
    }

    if (allLeagues.length === 0) {
      display.displayError(`No leagues found for user '${username}' in ${seasons.join(' or ')}.`);
      display.displayInfo('Make sure your Sleeper username is correct.');
      return null;
    }

    console.log('\nYour Leagues:');
    allLeagues.forEach((league, idx) => {
      console.log(`${idx + 1}. ${league.name} (${league.season})`);
    });

    const selection = await prompt('\nSelect a league (enter number): ');
    const leagueIndex = parseInt(selection) - 1;

    if (leagueIndex < 0 || leagueIndex >= allLeagues.length) {
      display.displayError('Invalid selection.');
      return null;
    }

    return { user, league: allLeagues[leagueIndex] };
  } catch (error) {
    display.displayError(`Failed to fetch leagues: ${error.message}`);
    return null;
  }
}

/**
 * Main application flow
 */
async function runAnalyzer(username, leagueId) {
  try {
    let user, league;

    // Get user
    user = await api.getUser(username);
    display.displaySuccess(`Found user: ${user.display_name}`);

    // Get league
    if (leagueId) {
      league = await api.getLeague(leagueId);
    } else {
      const selection = await selectLeague(username);
      if (!selection) return;
      user = selection.user;
      league = selection.league;
    }

    display.displaySuccess(`Analyzing league: ${league.name}`);

    // Analyze league standings and playoff probability
    display.displayInfo('Calculating standings and playoff probability...');
    const standingsAnalysis = await standings.analyzeStandings(user.user_id, league.league_id);
    console.log('\n' + '='.repeat(70));
    console.log(standings.formatStandings(standingsAnalysis));
    console.log('='.repeat(70) + '\n');

    // Get user's roster
    const roster = await rosterService.getUserRoster(user.user_id, league.league_id);
    if (!roster) {
      display.displayError('Could not find your roster in this league.');
      return;
    }

    // Display current roster
    const formatted = await rosterService.formatRoster(roster);
    display.displayRoster(formatted);

    // Analyze lineup
    display.displayInfo('Analyzing optimal lineup...');
    const lineupAnalysis = await optimizer.analyzeLineup(league.league_id, roster);
    display.displayLineupAnalysis(lineupAnalysis);

    // Analyze roster needs
    display.displayInfo('Analyzing roster depth...');
    const rosterNeeds = await waiverAnalyzer.analyzeRosterNeeds(league.league_id, roster);
    display.displayRosterNeeds(rosterNeeds);

    // Show trending available players
    display.displayInfo('Checking trending players...');
    const trending = await waiverAnalyzer.getTrendingAvailable(league.league_id);
    if (trending.length > 0) {
      display.displayTrending(trending);
    }

    // Show top available by position
    display.displayInfo('Finding best available players...');
    const topAvailable = await waiverAnalyzer.getTopAvailable(league.league_id, 5);
    display.displayWaiverRecommendations(topAvailable, 5);

    // Analyze First to Go (droppable/tradeable players)
    display.displayInfo('Analyzing droppable and tradeable players...');
    const currentWeek = await rosterService.getCurrentWeek();
    const firstToGoAnalysis = await firstToGo.analyzeFirstToGo(formatted, currentWeek);
    console.log('\n' + '='.repeat(70));
    console.log(firstToGo.formatFirstToGo(firstToGoAnalysis));
    console.log('='.repeat(70) + '\n');

    // Generate AI summary and recommendations
    display.displayInfo('Generating strategic recommendations...');
    const summary = await aiSummary.generateTeamSummary(
      user.user_id,
      league.league_id,
      lineupAnalysis,
      rosterNeeds,
      trending,
      topAvailable
    );
    console.log('\n' + '='.repeat(70));
    console.log(aiSummary.formatSummary(summary));
    console.log('='.repeat(70) + '\n');

  } catch (error) {
    display.displayError(`Analysis failed: ${error.message}`);
    console.error(error);
  }
}

// CLI setup
program
  .name('fantasy-analyzer')
  .description('Sleeper fantasy football lineup optimizer and waiver wire analyzer')
  .version('1.0.0')
  .option('-u, --username <username>', 'Your Sleeper username')
  .option('-l, --league <leagueId>', 'League ID (optional, will prompt if not provided)')
  .action(async (options) => {
    if (!options.username) {
      console.log('Welcome to Fantasy Analyzer!\n');
      options.username = await prompt('Enter your Sleeper username: ');
    }

    await runAnalyzer(options.username, options.league);
  });

program.parse();

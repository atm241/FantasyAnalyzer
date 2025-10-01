#!/usr/bin/env node

import { program } from 'commander';
import { PlatformAdapter } from './adapters/platformAdapter.js';
import { RosterService } from './services/roster.js';
import { LineupOptimizer } from './services/optimizer.js';
import { WaiverAnalyzer } from './services/waivers.js';
import { AISummaryService } from './services/aiSummary.js';
import { FirstToGoAnalyzer } from './services/firstToGo.js';
import { StandingsAnalyzer } from './services/standings.js';
import { DisplayFormatter } from './display/formatter.js';
import readline from 'readline';

let api, rosterService, optimizer, waiverAnalyzer, aiSummary, firstToGo, standings;
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

    // For ESPN, find the user's team by matching username/team name
    if (api.platform === 'espn') {
      const users = await api.getLeagueUsers(league.league_id);

      // Try to match by display name or team name
      const matchedUser = users.find(u =>
        u.display_name?.toLowerCase().includes(username.toLowerCase()) ||
        u.metadata?.team_name?.toLowerCase().includes(username.toLowerCase())
      );

      if (matchedUser) {
        user = matchedUser;
        display.displayInfo(`Matched to team: ${user.metadata?.team_name || user.display_name}`);
      } else {
        // If no match, show available teams with roster preview
        console.log('\nCould not auto-match your team. Please select from the list:');

        const rosters = await api.getLeagueRosters(league.league_id);
        const allPlayers = await rosterService.loadPlayers();

        // Check if we have roster data
        const hasRosterData = rosters.some(r => r.players && r.players.length > 0);

        if (hasRosterData) {
          console.log('(Showing top players on each team to help identify yours)\n');
        } else {
          console.log('(League rosters not yet populated - check your ESPN app for team owner names)\n');
        }

        for (let idx = 0; idx < users.length; idx++) {
          const u = users[idx];
          const roster = rosters.find(r => r.owner_id === u.user_id);

          const teamInfo = u.metadata?.team_name !== `Team ${u.user_id}` ?
            `${u.metadata?.team_name}` :
            `Team ${idx + 1}`;

          console.log(`${idx + 1}. ${teamInfo}`);

          // Show top 3 players if available
          if (hasRosterData && roster && roster.players && roster.players.length > 0) {
            const topPlayers = roster.players.slice(0, 3).map(playerId => {
              const player = allPlayers[playerId];
              return player?.full_name || 'Unknown Player';
            });
            console.log(`   Players: ${topPlayers.join(', ')}${roster.players.length > 3 ? '...' : ''}`);
          }
          console.log('');
        }

        const selection = await prompt('Select your team number: ');
        const teamIndex = parseInt(selection) - 1;

        if (teamIndex >= 0 && teamIndex < users.length) {
          user = users[teamIndex];
        } else {
          display.displayError('Invalid team selection');
          return;
        }
      }
    }

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
  .description('Fantasy football lineup optimizer and waiver wire analyzer for Sleeper and ESPN')
  .version('1.0.0')
  .option('-p, --platform <platform>', 'Platform: sleeper or espn (default: sleeper)', 'sleeper')
  .option('-u, --username <username>', 'Your username (Sleeper only)')
  .option('-l, --league <leagueId>', 'League ID')
  .option('--espn-s2 <espnS2>', 'ESPN S2 cookie (for private leagues)')
  .option('--swid <swid>', 'ESPN SWID cookie (for private leagues)')
  .option('-s, --season <season>', 'Season year (default: 2025)', '2025')
  .action(async (options) => {
    const platform = options.platform.toLowerCase();

    console.log(`Welcome to Fantasy Analyzer (${platform.toUpperCase()})!\n`);

    // Initialize platform adapter
    const config = {
      season: parseInt(options.season),
      leagueId: options.league
    };

    if (platform === 'espn') {
      // ESPN-specific config
      if (options.espnS2 && options.swid) {
        config.cookies = {
          espn_s2: options.espnS2,
          SWID: options.swid
        };
      }

      if (!options.league) {
        options.league = await prompt('Enter your ESPN League ID: ');
        config.leagueId = options.league;
      }

      // ESPN doesn't use username, so create a placeholder
      if (!options.username) {
        options.username = await prompt('Enter your team name or identifier: ');
      }
    } else {
      // Sleeper-specific
      if (!options.username) {
        options.username = await prompt('Enter your Sleeper username: ');
      }
    }

    // Initialize API and services
    api = new PlatformAdapter(platform, config);
    rosterService = new RosterService(api);
    optimizer = new LineupOptimizer(rosterService);
    waiverAnalyzer = new WaiverAnalyzer(rosterService, api);
    aiSummary = new AISummaryService(rosterService);
    firstToGo = new FirstToGoAnalyzer(rosterService);
    standings = new StandingsAnalyzer(api, rosterService);

    await runAnalyzer(options.username, options.league);
  });

program.parse();

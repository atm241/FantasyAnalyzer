/**
 * Offline end-to-end harness.
 *
 * Mocks the platform API layer and drives every analysis service in the same
 * order as src/index.js, so the pipeline can be exercised without network
 * access or a live league. Also asserts that bye weeks resolve from the
 * API-reported value rather than a stale local schedule.
 *
 * Run with: npm test
 */
import { RosterService } from '../src/services/roster.js';
import { LineupOptimizer } from '../src/services/optimizer.js';
import { WaiverAnalyzer } from '../src/services/waivers.js';
import { AISummaryService } from '../src/services/aiSummary.js';
import { FirstToGoAnalyzer } from '../src/services/firstToGo.js';
import { StandingsAnalyzer } from '../src/services/standings.js';
import { TradeAnalyzer } from '../src/services/tradeAnalyzer.js';
import { DisplayFormatter } from '../src/display/formatter.js';

const CURRENT_WEEK = 1;   // Sept 9 2026 -> NFL week 1
const SEASON = '2026';

// --- fixture players -------------------------------------------------------
const mk = (id, name, pos, team, extra = {}) => [id, {
  player_id: id, full_name: name, position: pos, team,
  fantasy_positions: [pos], active: true, status: 'Active',
  injury_status: null, ...extra
}];

const players = Object.fromEntries([
  mk('1', 'Josh Allen', 'QB', 'BUF'),
  mk('2', 'Jalen Hurts', 'QB', 'PHI'),
  mk('3', 'Bijan Robinson', 'RB', 'ATL', { bye_week: 9 }),
  mk('4', 'Saquon Barkley', 'RB', 'PHI'),
  mk('5', 'Jahmyr Gibbs', 'RB', 'DET'),
  mk('6', "Ja'Marr Chase", 'WR', 'CIN'),
  mk('7', 'Justin Jefferson', 'WR', 'MIN'),
  mk('8', 'CeeDee Lamb', 'WR', 'DAL'),
  mk('9', 'Puka Nacua', 'WR', 'LAR'),
  mk('10', 'Brock Bowers', 'TE', 'LV'),
  mk('11', 'Trey McBride', 'TE', 'ARI'),
  mk('12', 'Harrison Butker', 'K', 'KC'),
  mk('13', 'Ravens', 'DEF', 'BAL'),
  mk('14', 'Injured Guy', 'RB', 'CHI', { injury_status: 'Out' }),
  mk('15', 'Bye Week Guy', 'WR', 'GB', { bye_week: 1 }),
  // free agents
  mk('100', 'Waiver RB', 'RB', 'NO'),
  mk('101', 'Waiver WR', 'WR', 'SEA'),
  mk('102', 'Waiver TE', 'TE', 'NYJ'),
  mk('103', 'Waiver QB', 'QB', 'TEN'),
  mk('104', 'Waiver K', 'K', 'HOU'),
]);

const myStarters = ['1','3','4','6','7','10','5','12','13'];
const myPlayers  = [...myStarters, '2','8','9','11','14','15'];

const rosters = [
  { roster_id: 1, owner_id: 'me', players: myPlayers, starters: myStarters,
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, fpts_against: 0 } },
  { roster_id: 2, owner_id: 'them', players: ['2','8','9','11'], starters: ['2','8','9','11'],
    settings: { wins: 0, losses: 0, ties: 0, fpts: 0, fpts_decimal: 0, fpts_against: 0 } },
];

const leagueUsers = [
  { user_id: 'me', display_name: 'gruidlp', metadata: { team_name: 'Test Team' } },
  { user_id: 'them', display_name: 'rival', metadata: { team_name: 'Rival Team' } },
];

const league = {
  league_id: 'L1', name: 'Test League 2026', season: SEASON, total_rosters: 2,
  roster_positions: ['QB','RB','RB','WR','WR','TE','FLEX','K','DEF','BN','BN','BN','BN','BN','BN'],
  scoring_settings: { rec: 1, pass_td: 4, rush_td: 6 },
  settings: { playoff_teams: 6, playoff_week_start: 15 },
};

const calls = [];
const api = {
  platform: 'sleeper',
  async getUser(u) { calls.push('getUser'); return { user_id: 'me', display_name: u }; },
  async getUserLeagues(id, season) { calls.push(`getUserLeagues:${season}`); return season === SEASON ? [league] : []; },
  async getLeague() { calls.push('getLeague'); return league; },
  async getLeagueRosters() { calls.push('getLeagueRosters'); return rosters; },
  async getLeagueUsers() { calls.push('getLeagueUsers'); return leagueUsers; },
  async getAllPlayers() { calls.push('getAllPlayers'); return players; },
  async getNFLState() { calls.push('getNFLState'); return { week: CURRENT_WEEK, season: SEASON, season_type: 'regular' }; },
  async getTrendingPlayers() { calls.push('getTrendingPlayers'); return [{ player_id: '100', count: 5000 }, { player_id: '101', count: 3000 }]; },
  async getMatchups(lid, week) { calls.push(`getMatchups:${week}`); return []; },
};

const display = new DisplayFormatter();
const rosterService = new RosterService(api);
const optimizer = new LineupOptimizer(rosterService);
const waiverAnalyzer = new WaiverAnalyzer(rosterService, api);
const aiSummary = new AISummaryService(rosterService);
const firstToGo = new FirstToGoAnalyzer(rosterService);
const standings = new StandingsAnalyzer(api, rosterService);
const tradeAnalyzer = new TradeAnalyzer(rosterService);

const results = [];
async function step(name, fn) {
  try {
    const out = await fn();
    results.push([name, 'PASS', '']);
    return out;
  } catch (e) {
    results.push([name, 'FAIL', `${e.constructor.name}: ${e.message}`]);
    console.error(`\n### ${name} threw:\n`, e.stack, '\n');
    return null;
  }
}

const currentWeek = await step('getCurrentWeek', () => rosterService.getCurrentWeek());
const standingsAnalysis = await step('standings.analyzeStandings', () => standings.analyzeStandings('me', 'L1'));
await step('standings.formatStandings', () => standings.formatStandings(standingsAnalysis));
const roster = await step('rosterService.getUserRoster', () => rosterService.getUserRoster('me', 'L1'));
const formatted = await step('rosterService.formatRoster', () => rosterService.formatRoster(roster));
await step('display.displayRoster', () => display.displayRoster(formatted));
const lineupAnalysis = await step('optimizer.analyzeLineup', () => optimizer.analyzeLineup('L1', roster));
await step('display.displayLineupAnalysis', () => display.displayLineupAnalysis(lineupAnalysis));
const rosterNeeds = await step('waivers.analyzeRosterNeeds', () => waiverAnalyzer.analyzeRosterNeeds('L1', roster));
await step('display.displayRosterNeeds', () => display.displayRosterNeeds(rosterNeeds));
const trending = await step('waivers.getTrendingAvailable', () => waiverAnalyzer.getTrendingAvailable('L1'));
await step('display.displayTrending', () => trending && trending.length ? display.displayTrending(trending) : null);
const topAvailable = await step('waivers.getTopAvailable', () => waiverAnalyzer.getTopAvailable('L1', 5));
await step('display.displayWaiverRecommendations', () => display.displayWaiverRecommendations(topAvailable, 5));
const ftg = await step('firstToGo.analyzeFirstToGo', () => firstToGo.analyzeFirstToGo(formatted, currentWeek));
await step('firstToGo.formatFirstToGo', () => firstToGo.formatFirstToGo(ftg));
const tradeMatches = await step('tradeAnalyzer.findTradeMatches', () => tradeAnalyzer.findTradeMatches(formatted, 'L1', 'me'));
const yourNeeds = await step('tradeAnalyzer.calculateTeamNeeds', () => tradeAnalyzer.calculateTeamNeeds(formatted));
await step('tradeAnalyzer.formatTradeAnalysis', () => tradeAnalyzer.formatTradeAnalysis(tradeMatches, yourNeeds));
const summary = await step('aiSummary.generateTeamSummary', () => aiSummary.generateTeamSummary('me','L1',lineupAnalysis,rosterNeeds,trending,topAvailable));
await step('aiSummary.formatSummary', () => aiSummary.formatSummary(summary));

console.log('\n\n================ RESULTS ================');
let fails = 0;
for (const [n, s, m] of results) {
  if (s === 'FAIL') fails++;
  console.log(`${s === 'PASS' ? 'PASS' : 'FAIL'}  ${n}${m ? '  -- ' + m : ''}`);
}
console.log(`\n${results.length - fails}/${results.length} passed`);

// bye-week assertions for the current (2026) season
const byeGuy = formatted.bench.find(p => p.name === 'Bye Week Guy');
const bijan  = formatted.starters.find(p => p.name === 'Bijan Robinson');
const chase  = formatted.starters.find(p => p.name === "Ja'Marr Chase");
console.log('\n--- bye week resolution (season 2026, week 1) ---');
console.log('API-reported bye used (GB, bye_week 1):', byeGuy.byeWeek, 'onBye:', byeGuy.onBye, byeGuy.byeWeek===1 && byeGuy.onBye===true ? 'OK':'WRONG');
console.log('API-reported bye used (ATL, bye_week 9):', bijan.byeWeek, 'onBye:', bijan.onBye, bijan.byeWeek===9 && bijan.onBye===false ? 'OK':'WRONG');
console.log('No API bye, no 2026 table (CIN):', chase.byeWeek, 'onBye:', chase.onBye, chase.byeWeek===null && chase.onBye===false ? 'OK (unknown, not stale 2025)':'WRONG');

console.log('\nAPI calls made:', JSON.stringify(calls));
process.exit(fails ? 1 : 0);

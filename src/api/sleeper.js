import axios from 'axios';
import { getCurrentSeasonYear } from '../data/nflSchedule.js';
import { readCache, writeCache } from '../utils/diskCache.js';

const SLEEPER_BASE_URL = 'https://api.sleeper.app/v1';
const SLEEPER_PROJECTIONS_URL = 'https://api.sleeper.app/projections/nfl';
const FANTASY_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/** Injury and team fields that change faster than the cached player index. */
const LIVE_PLAYER_FIELDS = [
  'injury_status', 'injury_body_part', 'injury_notes',
  'team', 'position', 'fantasy_positions'
];

const PLAYERS_CACHE_KEY = 'sleeper-players';
const PLAYERS_CACHE_HOURS = 24;

/** The only player fields this tool reads. */
const PLAYER_FIELDS = [
  'player_id', 'full_name', 'first_name', 'last_name',
  'position', 'fantasy_positions', 'team',
  'status', 'injury_status', 'injury_body_part', 'active',
  'depth_chart_order', 'search_rank'
];

/** Keep only the fields used, which cuts the feed from ~14 MB to under 1 MB. */
function slimPlayers(players) {
  const slim = {};
  for (const [id, player] of Object.entries(players)) {
    if (!player) continue;
    const entry = {};
    for (const field of PLAYER_FIELDS) {
      if (player[field] != null) entry[field] = player[field];
    }
    slim[id] = entry;
  }
  return slim;
}

/**
 * Sleeper API Client
 */
export class SleeperAPI {
  constructor() {
    this.baseURL = SLEEPER_BASE_URL;
  }

  /**
   * Get user by username
   */
  async getUser(username) {
    const response = await axios.get(`${this.baseURL}/user/${username}`);
    return response.data;
  }

  /**
   * Get all leagues for a user in a specific season
   */
  async getUserLeagues(userId, season = getCurrentSeasonYear()) {
    const response = await axios.get(`${this.baseURL}/user/${userId}/leagues/nfl/${season}`);
    return response.data;
  }

  /**
   * Get specific league details
   */
  async getLeague(leagueId) {
    const response = await axios.get(`${this.baseURL}/league/${leagueId}`);
    return response.data;
  }

  /**
   * Get all rosters in a league
   */
  async getLeagueRosters(leagueId) {
    const response = await axios.get(`${this.baseURL}/league/${leagueId}/rosters`);
    return response.data;
  }

  /**
   * Get all users in a league
   */
  async getLeagueUsers(leagueId) {
    const response = await axios.get(`${this.baseURL}/league/${leagueId}/users`);
    return response.data;
  }

  /**
   * Get all NFL players, keyed by player id.
   *
   * The raw feed is ~14 MB and Sleeper asks that it be pulled at most once a
   * day, so it is trimmed to the fields this tool uses (~4% of the payload) and
   * cached on disk.
   */
  async getAllPlayers(forceRefresh = false) {
    const cached = forceRefresh ? null : readCache(PLAYERS_CACHE_KEY, PLAYERS_CACHE_HOURS);
    if (cached) return cached;

    const response = await axios.get(`${this.baseURL}/players/nfl`);
    const slim = slimPlayers(response.data || {});
    writeCache(PLAYERS_CACHE_KEY, slim);
    return slim;
  }

  /**
   * Get current NFL state (week, season)
   */
  async getNFLState() {
    const response = await axios.get(`${this.baseURL}/state/nfl`);
    return response.data;
  }

  /**
   * Get trending players
   */
  async getTrendingPlayers(type = 'add', hours = 24) {
    const response = await axios.get(`${this.baseURL}/players/nfl/trending/${type}?lookback_hours=${hours}`);
    return response.data;
  }

  /**
   * Get matchups for a specific week
   */
  /**
   * Get this week's projections.
   *
   * Uses the projections feed that embeds each player's current record rather
   * than the stats-only variant, because it carries live injury designations.
   * The bulk player index is cached for a day, so without this an injury that
   * cleared the same day would still read as OUT.
   *
   * Returns { stats, players }: projected stat lines keyed by player id, and
   * the fresh injury/team fields to overlay onto the cached index.
   */
  async getProjections(season, week) {
    const response = await axios.get(`${SLEEPER_PROJECTIONS_URL}/${season}/${week}`, {
      params: {
        season_type: 'regular',
        'position[]': FANTASY_POSITIONS,
        order_by: 'ppr'
      }
    });

    const stats = {};
    const players = {};

    for (const entry of response.data || []) {
      const playerId = entry.player_id ?? entry.player?.player_id;
      if (!playerId) continue;

      if (entry.stats) stats[playerId] = entry.stats;

      if (entry.player) {
        const live = {};
        for (const field of LIVE_PLAYER_FIELDS) {
          if (entry.player[field] !== undefined) live[field] = entry.player[field];
        }
        players[playerId] = live;
      }
    }

    return { stats, players };
  }

  async getMatchups(leagueId, week) {
    const response = await axios.get(`${this.baseURL}/league/${leagueId}/matchups/${week}`);
    return response.data;
  }
}

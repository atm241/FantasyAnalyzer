import axios from 'axios';

const SLEEPER_BASE_URL = 'https://api.sleeper.app/v1';

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
  async getUserLeagues(userId, season = '2024') {
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
   * Get all NFL players (cached data)
   */
  async getAllPlayers() {
    const response = await axios.get(`${this.baseURL}/players/nfl`);
    return response.data;
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
}

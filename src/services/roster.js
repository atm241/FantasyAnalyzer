import { isOnBye, getByeWeek, loadSchedule } from '../data/nflSchedule.js';
import { getPlayerName } from '../utils/playerName.js';

/**
 * Roster management and display
 */
export class RosterService {
  constructor(api) {
    this.api = api;
    this.players = null;
    this.nflState = null;
  }

  /**
   * Load and cache all NFL players
   */
  async loadPlayers() {
    if (!this.players) {
      this.players = await this.api.getAllPlayers();
    }
    return this.players;
  }

  /**
   * Get and cache the current NFL state (week + season)
   */
  async getNFLState() {
    if (!this.nflState) {
      this.nflState = await this.api.getNFLState();
    }
    return this.nflState;
  }

  /**
   * Get current NFL week
   */
  async getCurrentWeek() {
    return (await this.getNFLState()).week;
  }

  /**
   * Get current NFL season
   */
  async getCurrentSeason() {
    return (await this.getNFLState()).season;
  }

  /**
   * Make sure the current season's schedule (and therefore BYE weeks) is loaded
   */
  async ensureSchedule() {
    await loadSchedule(await this.getCurrentSeason());
  }

  /**
   * Get player details by ID
   */
  getPlayer(playerId) {
    return this.players?.[playerId] || null;
  }

  /**
   * Get user's roster for a specific league
   */
  async getUserRoster(userId, leagueId) {
    const rosters = await this.api.getLeagueRosters(leagueId);
    return rosters.find(roster => roster.owner_id === userId);
  }

  /**
   * Format roster with player details
   */
  async formatRoster(roster) {
    await this.loadPlayers();
    await this.ensureSchedule();
    const currentWeek = await this.getCurrentWeek();

    const starters = roster.starters.map(playerId => {
      const player = this.getPlayer(playerId);
      const team = player?.team || 'FA';
      return {
        playerId,
        name: getPlayerName(player),
        position: player?.position || 'N/A',
        team,
        status: player?.status || 'Active',
        injuryStatus: player?.injury_status || null,
        onBye: isOnBye(team, currentWeek),
        byeWeek: getByeWeek(team),
        realProjection: player?.projected_points || null
      };
    });

    const bench = roster.players
      .filter(playerId => !roster.starters.includes(playerId))
      .map(playerId => {
        const player = this.getPlayer(playerId);
        const team = player?.team || 'FA';
        return {
          playerId,
          name: getPlayerName(player),
          position: player?.position || 'N/A',
          team,
          status: player?.status || 'Active',
          injuryStatus: player?.injury_status || null,
          onBye: isOnBye(team, currentWeek),
          byeWeek: getByeWeek(team),
          realProjection: player?.projected_points || null
        };
      });

    return { starters, bench };
  }

  /**
   * Get available players (not rostered in league)
   */
  async getAvailablePlayers(leagueId, position = null) {
    await this.loadPlayers();
    await this.ensureSchedule();
    const currentWeek = await this.getCurrentWeek();
    const rosters = await this.api.getLeagueRosters(leagueId);

    // Collect all rostered player IDs
    const rosteredIds = new Set();
    rosters.forEach(roster => {
      roster.players?.forEach(playerId => rosteredIds.add(playerId));
    });

    // Filter available players
    const available = [];
    for (const [playerId, player] of Object.entries(this.players)) {
      if (!rosteredIds.has(playerId) &&
          player.active &&
          player.fantasy_positions?.length > 0 &&
          (!position || player.position === position)) {
        const team = player.team || 'FA';
        available.push({
          playerId,
          name: getPlayerName(player),
          position: player.position,
          team,
          status: player.status,
          injuryStatus: player.injury_status,
          onBye: isOnBye(team, currentWeek),
          byeWeek: getByeWeek(team)
        });
      }
    }

    return available;
  }

  /**
   * Get league scoring settings
   */
  async getScoringSettings(leagueId) {
    const league = await this.api.getLeague(leagueId);
    return league.scoring_settings;
  }

  /**
   * Get league roster positions
   */
  async getRosterPositions(leagueId) {
    const league = await this.api.getLeague(leagueId);
    return league.roster_positions;
  }
}

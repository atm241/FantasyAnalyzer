import { getByeWeek } from '../data/byeWeeks.js';

/**
 * Roster management and display
 */
export class RosterService {
  constructor(api) {
    this.api = api;
    this.players = null;
    this.currentWeek = null;
    this.currentSeason = null;
  }

  /**
   * Resolve a player's bye week, preferring the value the platform API reports
   * over the local schedule table so the data stays correct year to year.
   */
  resolveByeWeek(player, team) {
    const reported = Number(player?.bye_week);
    if (Number.isInteger(reported) && reported > 0) return reported;
    return getByeWeek(team, this.currentSeason);
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
   * Get current NFL week
   */
  async getCurrentWeek() {
    if (!this.currentWeek) {
      const nflState = await this.api.getNFLState();
      this.currentWeek = nflState.week;
      this.currentSeason = nflState.season;
    }
    return this.currentWeek;
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
    const currentWeek = await this.getCurrentWeek();

    const starters = roster.starters.map(playerId => {
      const player = this.getPlayer(playerId);
      const team = player?.team || 'FA';
      const byeWeek = this.resolveByeWeek(player, team);
      return {
        playerId,
        name: player?.full_name || 'Unknown',
        position: player?.position || 'N/A',
        team,
        status: player?.status || 'Active',
        injuryStatus: player?.injury_status || null,
        onBye: byeWeek === currentWeek,
        byeWeek,
        realProjection: player?.projected_points || null
      };
    });

    const bench = roster.players
      .filter(playerId => !roster.starters.includes(playerId))
      .map(playerId => {
        const player = this.getPlayer(playerId);
        const team = player?.team || 'FA';
        const byeWeek = this.resolveByeWeek(player, team);
        return {
          playerId,
          name: player?.full_name || 'Unknown',
          position: player?.position || 'N/A',
          team,
          status: player?.status || 'Active',
          injuryStatus: player?.injury_status || null,
          onBye: byeWeek === currentWeek,
          byeWeek,
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
        const byeWeek = this.resolveByeWeek(player, team);
        available.push({
          playerId,
          name: player.full_name,
          position: player.position,
          team,
          status: player.status,
          injuryStatus: player.injury_status,
          onBye: byeWeek === currentWeek,
          byeWeek
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

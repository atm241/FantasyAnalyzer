import { SleeperAPI } from '../api/sleeper.js';
import { EspnAPI } from '../api/espn.js';

/**
 * Platform adapter to normalize data from different fantasy platforms
 */
export class PlatformAdapter {
  constructor(platform = 'sleeper', config = {}) {
    this.platform = platform.toLowerCase();
    this.config = config;

    if (this.platform === 'sleeper') {
      this.api = new SleeperAPI();
    } else if (this.platform === 'espn') {
      this.api = new EspnAPI();
    } else {
      throw new Error(`Unsupported platform: ${platform}`);
    }
  }

  /**
   * Get user by username/identifier
   */
  async getUser(identifier) {
    if (this.platform === 'sleeper') {
      return await this.api.getUser(identifier);
    } else if (this.platform === 'espn') {
      // ESPN doesn't have user lookup by username
      // Return a mock user object
      return {
        user_id: this.config.userId || 'espn_user',
        display_name: identifier
      };
    }
  }

  /**
   * Get user's leagues
   */
  async getUserLeagues(userId, season = '2025') {
    if (this.platform === 'sleeper') {
      return await this.api.getUserLeagues(userId, season);
    } else if (this.platform === 'espn') {
      // ESPN requires league ID upfront, return single league
      if (!this.config.leagueId) {
        throw new Error('ESPN requires leagueId in config');
      }

      const leagueData = await this.api.getLeague(
        this.config.leagueId,
        parseInt(season),
        this.config.cookies || {}
      );

      const normalized = this.api.parseLeagueData(leagueData);
      return [normalized];
    }
  }

  /**
   * Get league details
   */
  async getLeague(leagueId) {
    if (this.platform === 'sleeper') {
      return await this.api.getLeague(leagueId);
    } else if (this.platform === 'espn') {
      const leagueData = await this.api.getLeague(
        leagueId,
        this.config.season || 2025,
        this.config.cookies || {}
      );
      return this.api.parseLeagueData(leagueData);
    }
  }

  /**
   * Get league rosters
   */
  async getLeagueRosters(leagueId) {
    if (this.platform === 'sleeper') {
      return await this.api.getLeagueRosters(leagueId);
    } else if (this.platform === 'espn') {
      const leagueData = await this.api.getLeague(
        leagueId,
        this.config.season || 2025,
        this.config.cookies || {}
      );

      return leagueData.teams.map(team => {
        const parsed = this.api.parseTeamData(team, leagueData.members);
        return {
          roster_id: parsed.roster_id,
          owner_id: parsed.owner_id,
          players: [...parsed.roster.starters, ...parsed.roster.bench],
          starters: parsed.roster.starters,
          settings: {
            wins: parsed.wins,
            losses: parsed.losses,
            ties: parsed.ties,
            fpts: parsed.pointsFor
          }
        };
      });
    }
  }

  /**
   * Get league users
   */
  async getLeagueUsers(leagueId) {
    if (this.platform === 'sleeper') {
      return await this.api.getLeagueUsers(leagueId);
    } else if (this.platform === 'espn') {
      const leagueData = await this.api.getLeague(
        leagueId,
        this.config.season || 2025,
        this.config.cookies || {}
      );

      return leagueData.teams.map(team => {
        const owner = leagueData.members?.find(m => m.id === team.primaryOwner);
        const teamName = team.name ||
                        (team.location && team.nickname ? `${team.location} ${team.nickname}` : null) ||
                        `Team ${team.id}`;

        return {
          user_id: team.primaryOwner,
          display_name: owner?.displayName || owner?.firstName || 'Unknown',
          metadata: {
            team_name: teamName
          }
        };
      });
    }
  }

  /**
   * Get all players
   */
  async getAllPlayers() {
    if (this.platform === 'sleeper') {
      return await this.api.getAllPlayers();
    } else if (this.platform === 'espn') {
      // ESPN doesn't have a bulk player endpoint
      // We'll build a player cache from rosters
      if (!this.playerCache) {
        this.playerCache = {};

        if (this.config.leagueId) {
          const leagueData = await this.api.getLeague(
            this.config.leagueId,
            this.config.season || 2025,
            this.config.cookies || {}
          );

          leagueData.teams?.forEach(team => {
            team.roster?.entries?.forEach(entry => {
              const player = this.api.parsePlayerData(entry);
              if (player.playerId) {
                this.playerCache[player.playerId] = {
                  player_id: player.playerId,
                  full_name: player.name,
                  position: player.position,
                  team: player.team,
                  injury_status: player.injuryStatus,
                  status: player.status,
                  active: true,
                  fantasy_positions: [player.position]
                };
              }
            });
          });
        }
      }

      return this.playerCache;
    }
  }

  /**
   * Get NFL state (current week)
   */
  async getNFLState() {
    return await this.api.getNFLState();
  }

  /**
   * Get matchups for a specific week
   */
  async getMatchups(leagueId, week) {
    if (this.platform === 'sleeper') {
      return await this.api.getMatchups(leagueId, week);
    } else if (this.platform === 'espn') {
      const espnMatchups = await this.api.getMatchups(
        leagueId,
        this.config.season || 2025,
        week,
        this.config.cookies || {}
      );

      // Convert ESPN matchups to Sleeper format
      return espnMatchups.map(m => ({
        roster_id: m.home?.teamId,
        matchup_id: m.id,
        points: m.home?.totalPoints || 0,
        players: m.home?.rosterForCurrentScoringPeriod?.entries?.map(e => e.playerId.toString()) || []
      })).concat(
        espnMatchups
          .filter(m => m.away)
          .map(m => ({
            roster_id: m.away.teamId,
            matchup_id: m.id,
            points: m.away.totalPoints || 0,
            players: m.away.rosterForCurrentScoringPeriod?.entries?.map(e => e.playerId.toString()) || []
          }))
      );
    }
  }

  /**
   * Get trending players (Sleeper only)
   */
  async getTrendingPlayers(type = 'add', hours = 24) {
    if (this.platform === 'sleeper') {
      return await this.api.getTrendingPlayers(type, hours);
    } else if (this.platform === 'espn') {
      // ESPN doesn't have trending data, return empty
      return [];
    }
  }
}

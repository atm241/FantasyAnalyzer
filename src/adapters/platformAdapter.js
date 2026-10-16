import { SleeperAPI } from '../api/sleeper.js';
import { EspnAPI } from '../api/espn.js';
import { getCurrentSeasonYear } from '../data/nflSchedule.js';

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

    // League settings, rosters and the player index do not change during a run,
    // but are needed by almost every service. Without this they were refetched
    // dozens of times per run.
    this.cache = new Map();
  }

  /**
   * Memoise a request that is immutable for the lifetime of this run.
   * Stores the promise so concurrent callers share one request; a failed
   * request is evicted so it can be retried.
   */
  memo(key, fn) {
    if (!this.cache.has(key)) {
      this.cache.set(key, fn().catch(error => {
        this.cache.delete(key);
        throw error;
      }));
    }
    return this.cache.get(key);
  }

  /** The raw ESPN league payload, fetched once and shared by every consumer. */
  espnLeague(leagueId) {
    const season = this.config.season || getCurrentSeasonYear();
    return this.memo(`espn:${leagueId}:${season}`, () => this.api.getLeague(
      leagueId,
      parseInt(season),
      this.config.cookies || {}
    ));
  }

  /**
   * Get user by username/identifier
   */
  async getUser(identifier) {
    if (this.platform === 'sleeper') {
      return await this.memo(`user:${identifier}`, () => this.api.getUser(identifier));
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
  async getUserLeagues(userId, season = getCurrentSeasonYear()) {
    if (this.platform === 'sleeper') {
      return await this.api.getUserLeagues(userId, season);
    } else if (this.platform === 'espn') {
      // ESPN requires league ID upfront, return single league
      if (!this.config.leagueId) {
        throw new Error('ESPN requires leagueId in config');
      }

      const leagueData = await this.espnLeague(this.config.leagueId);

      const normalized = this.api.parseLeagueData(leagueData);
      return [normalized];
    }
  }

  /**
   * Get league details
   */
  async getLeague(leagueId) {
    if (this.platform === 'sleeper') {
      return await this.memo(`league:${leagueId}`, () => this.api.getLeague(leagueId));
    } else if (this.platform === 'espn') {
      const leagueData = await this.espnLeague(leagueId);
      return this.api.parseLeagueData(leagueData);
    }
  }

  /**
   * Get league rosters
   */
  async getLeagueRosters(leagueId) {
    if (this.platform === 'sleeper') {
      return await this.memo(`rosters:${leagueId}`, () => this.api.getLeagueRosters(leagueId));
    } else if (this.platform === 'espn') {
      const leagueData = await this.espnLeague(leagueId);

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
      return await this.memo(`users:${leagueId}`, () => this.api.getLeagueUsers(leagueId));
    } else if (this.platform === 'espn') {
      const leagueData = await this.espnLeague(leagueId);

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
      return await this.memo(
        'players',
        () => this.api.getAllPlayers(Boolean(this.config.refreshPlayers))
      );
    } else if (this.platform === 'espn') {
      // The player-pool view is the only route to free agents on ESPN; a cache
      // built from rosters alone left the waiver wire empty.
      return await this.memo('espnPlayers', async () => {
        const { week } = await this.getNFLState();
        const pool = await this.espnPool(week);

        // Rostered players still come from the league payload, since the pool
        // is capped by ownership and a deep bench player can fall outside it.
        const players = { ...pool };

        if (this.config.leagueId) {
          const leagueData = await this.espnLeague(this.config.leagueId);
          for (const team of leagueData.teams || []) {
            for (const entry of team.roster?.entries || []) {
              const parsed = this.api.parsePlayerData(entry);
              if (!parsed.playerId) continue;
              players[parsed.playerId] = {
                ...players[parsed.playerId],
                player_id: parsed.playerId,
                full_name: parsed.name,
                position: parsed.position,
                team: parsed.team,
                injury_status: parsed.injuryStatus,
                active: true,
                rostered: true
              };
            }
          }
        }

        return players;
      });
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
        this.config.season || getCurrentSeasonYear(),
        week,
        this.config.cookies || {}
      );

      // ESPN keeps the lineup for a week under rosterForCurrentScoringPeriod,
      // with each player's points on playerPoolEntry.appliedStatTotal. Both
      // starters and their scores are needed for the slot-by-slot scoreboard;
      // without them a played week reads as not started.
      const side = entry => {
        if (!entry) return null;

        const rows = entry.rosterForCurrentScoringPeriod?.entries ||
          entry.rosterForMatchupPeriod?.entries || [];

        const starting = rows
          .filter(row => {
            const slot = Number(row.lineupSlotId);
            return slot !== 20 && slot !== 21 && slot !== 24;
          })
          .map(row => ({
            playerId: String(row.playerId),
            slotId: Number(row.lineupSlotId),
            points: row.playerPoolEntry?.appliedStatTotal ?? 0
          }))
          .sort((a, b) => this.api.slotRank(a.slotId) - this.api.slotRank(b.slotId));

        return {
          roster_id: entry.teamId,
          points: entry.totalPoints || 0,
          players: rows.map(row => String(row.playerId)),
          starters: starting.map(p => p.playerId),
          starters_points: starting.map(p => p.points)
        };
      };

      const converted = [];
      for (const matchup of espnMatchups) {
        for (const entry of [matchup.home, matchup.away]) {
          const parsed = side(entry);
          if (parsed) converted.push({ ...parsed, matchup_id: matchup.id });
        }
      }

      return converted;
    }
  }

  /**
   * Get trending players (Sleeper only)
   */
  /**
   * Weekly projections keyed by player id. ESPN has no equivalent public feed,
   * so it falls back to the optimizer's own estimates.
   */
  async getProjections(season, week) {
    if (this.platform === 'sleeper') {
      return await this.memo(
        `projections:${season}:${week}`,
        () => this.api.getProjections(season, week)
      );
    }

    if (this.platform === 'espn') {
      const pool = await this.espnPool(week);
      const stats = {};
      const players = {};

      for (const [playerId, player] of Object.entries(pool)) {
        if (player.projected_week != null) {
          // ESPN applies the league's own scoring, so the same figure serves
          // every scoring format rather than needing a PPR variant.
          const points = player.projected_week;
          stats[playerId] = {
            pts_ppr: points, pts_half_ppr: points, pts_std: points
          };
        }
        players[playerId] = {
          injury_status: player.injury_status,
          team: player.team,
          position: player.position
        };
      }

      return { stats, players };
    }

    return { stats: {}, players: {} };
  }

  /**
   * Whether this platform can supply real player projections.
   *
   * ESPN has no public projections feed, and without one the estimate fallback
   * gives every player at a position the same score - which is not a projection
   * and must not be presented as one.
   */
  supportsProjections() {
    // ESPN publishes per-player projections too, in the player-pool view.
    return this.platform === 'sleeper' || this.platform === 'espn';
  }

  /** The ESPN player pool for a week, fetched once per run. */
  espnPool(week) {
    const season = this.config.season || getCurrentSeasonYear();
    return this.memo(`espnPool:${week}`, () => this.api.getPlayerPool(
      this.config.leagueId,
      week,
      parseInt(season),
      this.config.cookies || {}
    ));
  }

  /** Projections for a span of weeks, for rest-of-season value. */
  async getProjectionRange(season, fromWeek, toWeek) {
    if (this.platform === 'sleeper') {
      return await this.memo(
        `projrange:${season}:${fromWeek}:${toWeek}`,
        () => this.api.getProjectionRange(season, fromWeek, toWeek)
      );
    }

    if (this.platform === 'espn') {
      // ESPN projects a week at a time, so a span means a request per week.
      // Each is disk-cached and this only runs when something needs the rest
      // of the season, so the cost is paid once and only when asked for.
      return await this.memo(`projrange:${season}:${fromWeek}:${toWeek}`, async () => {
        const weeks = [];
        for (let week = fromWeek; week <= toWeek; week++) weeks.push(week);

        const pools = await Promise.all(
          weeks.map(week => this.espnPool(week).catch(() => ({})))
        );

        const byWeek = {};
        weeks.forEach((week, index) => {
          const stats = {};
          for (const [playerId, player] of Object.entries(pools[index])) {
            if (player.projected_week == null) continue;
            const points = player.projected_week;
            stats[playerId] = {
              pts_ppr: points, pts_half_ppr: points, pts_std: points
            };
          }
          byWeek[week] = stats;
        });

        return byWeek;
      });
    }

    return {};
  }

  async getTrendingPlayers(type = 'add', hours = 24) {
    if (this.platform === 'sleeper') {
      return await this.memo(
        `trending:${type}:${hours}`,
        () => this.api.getTrendingPlayers(type, hours)
      );
    } else if (this.platform === 'espn') {
      // ESPN doesn't have trending data, return empty
      return [];
    }
  }
}

import axios from 'axios';

const ESPN_BASE_URL = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';

/**
 * ESPN Fantasy Football API Client
 */
export class EspnAPI {
  constructor() {
    this.baseURL = ESPN_BASE_URL;
  }

  /**
   * Get league data
   */
  async getLeague(leagueId, seasonId = 2025, cookies = {}) {
    const config = {
      params: {
        view: ['mSettings', 'mTeam', 'mRoster', 'mMatchup', 'mStandings']
      }
    };

    // Add cookies for private leagues
    if (cookies.espn_s2 && cookies.SWID) {
      config.headers = {
        'Cookie': `espn_s2=${cookies.espn_s2}; SWID=${cookies.SWID}`
      };
    }

    const response = await axios.get(
      `${this.baseURL}/${seasonId}/segments/0/leagues/${leagueId}`,
      config
    );

    return response.data;
  }

  /**
   * Get league with specific scoring period (week)
   */
  async getLeagueForWeek(leagueId, seasonId, week, cookies = {}) {
    const config = {
      params: {
        view: ['mMatchup', 'mMatchupScore'],
        scoringPeriodId: week
      }
    };

    if (cookies.espn_s2 && cookies.SWID) {
      config.headers = {
        'Cookie': `espn_s2=${cookies.espn_s2}; SWID=${cookies.SWID}`
      };
    }

    const response = await axios.get(
      `${this.baseURL}/${seasonId}/segments/0/leagues/${leagueId}`,
      config
    );

    return response.data;
  }

  /**
   * Get all players (note: ESPN doesn't have a simple all-players endpoint like Sleeper)
   */
  async getAllPlayers() {
    // ESPN player data is embedded in league responses
    // For now, return empty - we'll get players from rosters
    return {};
  }

  /**
   * Get current NFL week (approximate from current date)
   */
  async getNFLState() {
    // ESPN doesn't have this endpoint, calculate based on season start
    const now = new Date();
    const seasonStart = new Date('2025-09-04'); // NFL season typically starts first Thursday of September

    if (now < seasonStart) {
      return { week: 1, season: '2025', season_type: 'pre' };
    }

    const weeksSinceStart = Math.floor((now - seasonStart) / (7 * 24 * 60 * 60 * 1000)) + 1;

    return {
      week: Math.min(weeksSinceStart, 18),
      season: '2025',
      season_type: 'regular'
    };
  }

  /**
   * Get matchups for a specific week
   */
  async getMatchups(leagueId, seasonId, week, cookies = {}) {
    const leagueData = await this.getLeagueForWeek(leagueId, seasonId, week, cookies);
    return leagueData.schedule?.filter(m => m.matchupPeriodId === week) || [];
  }

  /**
   * Parse ESPN league data into normalized format
   */
  parseLeagueData(espnData) {
    return {
      league_id: espnData.id.toString(),
      name: espnData.settings?.name || 'ESPN League',
      season: espnData.seasonId,
      settings: {
        playoff_teams: espnData.settings?.scheduleSettings?.playoffTeamCount || 6,
        playoff_week_start: espnData.settings?.scheduleSettings?.playoffMatchupPeriodLength ?
          (espnData.settings.scheduleSettings.regularSeasonMatchupPeriodCount + 1) : 15,
        num_teams: espnData.settings?.size || espnData.teams?.length || 0
      },
      scoring_settings: espnData.settings?.scoringSettings || {},
      roster_positions: this.getRosterPositions(espnData)
    };
  }

  /**
   * Get roster position slots
   */
  getRosterPositions(espnData) {
    const rosterSettings = espnData.settings?.rosterSettings?.lineupSlotCounts || {};
    const positions = [];

    // ESPN slot IDs to position names
    const slotMap = {
      0: 'QB',
      2: 'RB',
      4: 'WR',
      6: 'TE',
      16: 'DEF',
      17: 'K',
      23: 'FLEX',
      20: 'BENCH'
    };

    for (const [slotId, count] of Object.entries(rosterSettings)) {
      const position = slotMap[slotId] || 'UNKNOWN';
      for (let i = 0; i < count; i++) {
        positions.push(position);
      }
    }

    return positions;
  }

  /**
   * Parse team/roster data
   */
  parseTeamData(espnTeam, members) {
    const owner = members?.find(m => m.id === espnTeam.primaryOwner);

    return {
      roster_id: espnTeam.id,
      owner_id: espnTeam.primaryOwner,
      team_name: espnTeam.name || espnTeam.location + ' ' + espnTeam.nickname,
      wins: espnTeam.record?.overall?.wins || 0,
      losses: espnTeam.record?.overall?.losses || 0,
      ties: espnTeam.record?.overall?.ties || 0,
      pointsFor: espnTeam.record?.overall?.pointsFor || 0,
      pointsAgainst: espnTeam.record?.overall?.pointsAgainst || 0,
      roster: this.parseRoster(espnTeam.roster),
      username: owner?.displayName || 'Unknown'
    };
  }

  /**
   * Parse roster entries
   */
  parseRoster(rosterData) {
    if (!rosterData?.entries) return { starters: [], bench: [] };

    const starters = [];
    const bench = [];

    rosterData.entries.forEach(entry => {
      const playerId = entry.playerId.toString();
      const lineupSlotId = entry.lineupSlotId;

      // 20 is bench in ESPN
      if (lineupSlotId === 20 || lineupSlotId === 21) {
        bench.push(playerId);
      } else {
        starters.push(playerId);
      }
    });

    return { starters, bench };
  }

  /**
   * Parse player data from roster entry
   */
  parsePlayerData(entry) {
    const player = entry.playerPoolEntry?.player || {};

    // ESPN position map
    const positionMap = {
      1: 'QB',
      2: 'RB',
      3: 'WR',
      4: 'TE',
      5: 'K',
      16: 'DEF'
    };

    // ESPN injury status map
    const injuryMap = {
      'ACTIVE': null,
      'QUESTIONABLE': 'Questionable',
      'DOUBTFUL': 'Doubtful',
      'OUT': 'Out',
      'INJURY_RESERVE': 'IR'
    };

    return {
      playerId: player.id?.toString(),
      name: player.fullName,
      position: positionMap[player.defaultPositionId] || 'UNKNOWN',
      team: player.proTeamId ? this.getTeamAbbr(player.proTeamId) : 'FA',
      injuryStatus: injuryMap[player.injuryStatus] || null,
      status: player.injuryStatus === 'ACTIVE' ? 'Active' : 'Injured'
    };
  }

  /**
   * Get NFL team abbreviation from ESPN team ID
   */
  getTeamAbbr(proTeamId) {
    const teamMap = {
      1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN',
      8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR',
      15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ',
      21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA',
      27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU'
    };

    return teamMap[proTeamId] || 'FA';
  }
}

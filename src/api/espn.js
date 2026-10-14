import axios from 'axios';
import { loadSchedule, getCurrentSeasonYear } from '../data/nflSchedule.js';

const ESPN_BASE_URL = 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons';

/**
 * ESPN expects repeated `view=` parameters, not the `view[]=` form axios
 * produces by default. With brackets the API quietly returns a 1.6 KB stub
 * instead of the 2 MB league payload: no team names, no rosters, no scores.
 * Every ESPN request needs this.
 */
/**
 * ESPN lineup slot ids, in the order a lineup is conventionally listed.
 *
 * The order matters: the rest of the tool pairs the starters array with the
 * league's slots by index, so both have to agree. Reading them out of the
 * settings object gave numeric key order, which put FLEX last and mislabelled
 * every slot.
 */
const SLOT_ORDER = [
  [0, 'QB'],
  [2, 'RB'],
  [4, 'WR'],
  [6, 'TE'],
  [23, 'FLEX'],
  [3, 'WRRB_FLEX'],
  [5, 'REC_FLEX'],
  [7, 'SUPER_FLEX'],
  [16, 'DEF'],
  [17, 'K'],
  [20, 'BN']
];

/** Slots that hold a player but never score: not starting slots. */
const NON_SCORING_SLOTS = new Set([21, 24]);

/** Where a slot sits in a lineup, for ordering starters to match. */
function slotRank(slotId) {
  const index = SLOT_ORDER.findIndex(([id]) => id === Number(slotId));
  return index === -1 ? SLOT_ORDER.length : index;
}

function repeatParams(params) {
  const parts = [];
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? value : [value]) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(item)}`);
    }
  }
  return parts.join('&');
}

/**
 * ESPN Fantasy Football API Client
 */
/**
 * ESPN answers 401 for a private league read without cookies, and 404 for a
 * league id that does not exist. Raw axios errors bury that behind a wall of
 * request internals, so they are translated here.
 */
export class EspnAuthError extends Error {
  constructor(leagueId) {
    super(
      `ESPN league ${leagueId} is private. It needs your espn_s2 and SWID cookies to read.`
    );
    this.name = 'EspnAuthError';
    this.leagueId = leagueId;
    this.needsCookies = true;
  }
}

function translateEspnError(error, leagueId) {
  const status = error?.response?.status;
  if (status === 401 || status === 403) return new EspnAuthError(leagueId);
  if (status === 404) {
    return new Error(`ESPN league ${leagueId} was not found. Check the league ID.`);
  }
  return error;
}

export class EspnAPI {
  constructor() {
    this.baseURL = ESPN_BASE_URL;
  }

  /**
   * Get league data
   */
  async getLeague(leagueId, seasonId = getCurrentSeasonYear(), cookies = {}) {
    const config = {
      params: {
        view: ['mSettings', 'mTeam', 'mRoster', 'mMatchup', 'mStandings']
      },
      paramsSerializer: repeatParams
    };

    // Add cookies for private leagues
    if (cookies.espn_s2 && cookies.SWID) {
      config.headers = {
        'Cookie': `espn_s2=${cookies.espn_s2}; SWID=${cookies.SWID}`
      };
    }

    try {
      const response = await axios.get(
        `${this.baseURL}/${seasonId}/segments/0/leagues/${leagueId}`,
        config
      );
      return response.data;
    } catch (error) {
      throw translateEspnError(error, leagueId);
    }
  }

  /**
   * Get league with specific scoring period (week)
   */
  async getLeagueForWeek(leagueId, seasonId, week, cookies = {}) {
    const config = {
      params: {
        view: ['mMatchup', 'mMatchupScore'],
        scoringPeriodId: week
      },
      paramsSerializer: repeatParams
    };

    if (cookies.espn_s2 && cookies.SWID) {
      config.headers = {
        'Cookie': `espn_s2=${cookies.espn_s2}; SWID=${cookies.SWID}`
      };
    }

    try {
      const response = await axios.get(
        `${this.baseURL}/${seasonId}/segments/0/leagues/${leagueId}`,
        config
      );
      return response.data;
    } catch (error) {
      throw translateEspnError(error, leagueId);
    }
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
   * Get current NFL week and season.
   *
   * ESPN has no public season-state endpoint, so this is derived from the real
   * NFL schedule rather than a hardcoded kickoff date. A week stays current
   * until its last game has been played, which rolls the analysis over to the
   * next week for lineup planning.
   */
  async getNFLState() {
    const season = getCurrentSeasonYear();
    const schedule = await loadSchedule(season);

    return {
      week: schedule.currentWeek(),
      season: String(season),
      season_type: schedule.seasonType()
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
    const counts = espnData.settings?.rosterSettings?.lineupSlotCounts || {};
    const positions = [];

    // In lineup order, and skipping injured-reserve style slots. Counting IR
    // as a starting slot left the league claiming ten starters for a nine
    // player lineup, which broke the index pairing downstream.
    for (const [slotId, label] of SLOT_ORDER) {
      const count = Number(counts[slotId] || 0);
      for (let i = 0; i < count; i++) positions.push(label);
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

    const bench = [];
    const starting = [];

    for (const entry of rosterData.entries) {
      if (entry?.playerId == null) continue;
      const playerId = entry.playerId.toString();
      const slotId = Number(entry.lineupSlotId);

      // Bench and injured reserve both sit outside the lineup.
      if (slotId === 20 || NON_SCORING_SLOTS.has(slotId)) {
        bench.push(playerId);
      } else {
        starting.push({ playerId, slotId });
      }
    }

    // Sorted into lineup order so starters pair with the slots the league
    // reports; ESPN returns them in no particular order.
    starting.sort((a, b) => slotRank(a.slotId) - slotRank(b.slotId));

    return { starters: starting.map(p => p.playerId), bench };
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

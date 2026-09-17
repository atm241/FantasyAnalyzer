import { isOnBye, getByeWeek, loadSchedule } from '../data/nflSchedule.js';
import { loadTeamRankings } from '../data/teamRankings.js';
import { getPlayerName, isEmptySlot, realPlayers } from '../utils/playerName.js';
import { buildPositionEconomics, FANTASY_POSITIONS } from './positionValue.js';

/**
 * Roster management and display
 */
export class RosterService {
  constructor(api) {
    this.api = api;
    this.players = null;
    this.nflState = null;
    this.projections = null;
    this.economicsCache = new Map();
  }

  /**
   * League-specific position economics: how many of each position this league
   * actually starts (flex slots included) and what the waiver wire offers for
   * free. Shared by the waiver, trade and summary services.
   */
  async getEconomics(leagueId, roster = null) {
    const key = `${leagueId}:${roster ? 'mine' : 'league'}`;
    if (this.economicsCache.has(key)) return this.economicsCache.get(key);

    const rosterPositions = await this.getRosterPositions(leagueId);
    const rosters = await this.api.getLeagueRosters(leagueId);

    const availableByPosition = {};
    for (const position of FANTASY_POSITIONS) {
      availableByPosition[position] = await this.getAvailablePlayers(leagueId, position);
    }

    const rosteredByPosition = {};
    if (roster) {
      // Callers pass either a raw roster (ids) or one already formatted.
      const alreadyFormatted = typeof roster.starters?.[0] === 'object';
      const formatted = alreadyFormatted
        ? roster
        : await this.formatRoster(roster, leagueId);

      for (const player of realPlayers([...formatted.starters, ...formatted.bench])) {
        (rosteredByPosition[player.position] ||= []).push(player);
      }
    }

    const economics = buildPositionEconomics({
      rosterPositions,
      availableByPosition,
      rosteredByPosition,
      teams: rosters.length
    });

    this.economicsCache.set(key, economics);
    return economics;
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
   * Make sure the season data every projection depends on is loaded: the
   * schedule (BYE weeks) and the offensive tiers derived from real scoring.
   */
  async ensureSeasonData() {
    const season = await this.getCurrentSeason();
    // Players first: the projection load overlays live injury data onto them.
    await this.loadPlayers();
    await Promise.all([
      loadSchedule(season),
      loadTeamRankings(season),
      this.loadProjections()
    ]);
  }

  /**
   * Load and cache this week's projections, keyed by player id.
   *
   * A null cache means the feed was unavailable, which is different from a
   * player simply not being projected - see buildProjection().
   */
  async loadProjections() {
    if (this.projections !== null) return this.projections;

    const { season, week } = await this.getNFLState();
    try {
      const { stats, players } = await this.api.getProjections(season, week);
      this.projections = stats || {};
      this.refreshLivePlayerData(players);
    } catch (error) {
      this.projections = {};
      console.warn(
        `\u26a0\ufe0f  Could not load week ${week} projections (${error.message}). ` +
        'Falling back to estimated points.'
      );
    }
    return this.projections;
  }

  /**
   * Overlay live injury and team data onto the cached player index.
   *
   * The bulk player feed is cached for a day to keep runs fast, but injury
   * designations change through the week - a player cleared this morning must
   * not still read as OUT. The projections feed is fetched every run and
   * carries current designations, so it wins over the cached copy.
   */
  refreshLivePlayerData(livePlayers) {
    if (!livePlayers || !this.players) return 0;

    let updated = 0;
    for (const [playerId, live] of Object.entries(livePlayers)) {
      const cached = this.players[playerId];
      if (!cached) continue;

      for (const [field, value] of Object.entries(live)) {
        // null is meaningful here: it is how a cleared injury is reported.
        if (cached[field] !== value) {
          cached[field] = value;
          updated++;
        }
      }
    }
    return updated;
  }

  /** True when a projection feed actually loaded (vs. being unavailable). */
  hasProjections() {
    return Boolean(this.projections) && Object.keys(this.projections).length > 0;
  }

  /**
   * The projected points for a player under this league's scoring.
   *
   * Returns { realProjection, projected } where `projected` is false when the feed
   * has no entry for the player - Sleeper omits players it does not expect to
   * play, so they should not inherit an optimistic estimate.
   */
  buildProjection(playerId, scoringSettings) {
    const stats = this.projections?.[playerId];
    if (!stats) return { realProjection: null, projected: false };

    const reception = scoringSettings?.rec ?? 0;
    const points = reception >= 1
      ? stats.pts_ppr
      : reception >= 0.5
        ? stats.pts_half_ppr
        : stats.pts_std;

    const value = points ?? stats.pts_ppr ?? stats.pts_half_ppr ?? stats.pts_std;
    return value == null
      ? { realProjection: null, projected: false }
      : { realProjection: value, projected: true };
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
  async formatRoster(roster, leagueId = null) {
    await this.loadPlayers();
    await this.ensureSeasonData();
    const currentWeek = await this.getCurrentWeek();

    const scoringSettings = leagueId ? await this.getScoringSettings(leagueId) : null;

    // Starting slots in league order (QB, RB, RB, ... FLEX, DEF), so a player's
    // actual slot is known rather than assumed from their position.
    const startingSlots = leagueId
      ? (await this.getRosterPositions(leagueId)).filter(slot => slot !== 'BN')
      : [];

    const describe = (playerId, slotPosition) => {
      // Sleeper uses "0" for a starting slot left unfilled. It is not a player,
      // and it is the most actionable thing on a roster, so it is marked rather
      // than rendered as an unknown player.
      if (isEmptySlot(playerId)) {
        return {
          playerId: null,
          name: slotPosition ? `(empty ${slotPosition} slot)` : '(empty slot)',
          position: slotPosition || 'N/A',
          team: '--',
          status: 'Empty',
          injuryStatus: null,
          onBye: false,
          byeWeek: null,
          realProjection: 0,
          projected: true,
          emptySlot: true,
          ...(slotPosition ? { slotPosition } : {})
        };
      }

      const player = this.getPlayer(playerId);
      const team = player?.team || 'FA';
      const { realProjection, projected } = this.buildProjection(playerId, scoringSettings);
      return {
        playerId,
        name: getPlayerName(player),
        position: player?.position || 'N/A',
        team,
        status: player?.status || 'Active',
        injuryStatus: player?.injury_status || null,
        onBye: isOnBye(team, currentWeek),
        byeWeek: getByeWeek(team),
        realProjection,
        projected,
        // Sleeper's own signals, used instead of hand-maintained name lists.
        searchRank: player?.search_rank ?? null,
        depthChartOrder: player?.depth_chart_order ?? null,
        injuryBodyPart: player?.injury_body_part || null,
        ...(slotPosition ? { slotPosition } : {})
      };
    };

    const starters = roster.starters.map((playerId, idx) =>
      describe(playerId, startingSlots[idx]));

    const bench = roster.players
      .filter(playerId => !roster.starters.includes(playerId))
      .map(playerId => describe(playerId, null));

    return { starters, bench };
  }

  /**
   * Get available players (not rostered in league)
   */
  async getAvailablePlayers(leagueId, position = null) {
    await this.loadPlayers();
    await this.ensureSeasonData();
    const currentWeek = await this.getCurrentWeek();
    const rosters = await this.api.getLeagueRosters(leagueId);
    const scoringSettings = await this.getScoringSettings(leagueId);

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
          byeWeek: getByeWeek(team),
          searchRank: player.search_rank ?? null,
          depthChartOrder: player.depth_chart_order ?? null,
          injuryBodyPart: player.injury_body_part || null,
          ...this.buildProjection(playerId, scoringSettings)
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

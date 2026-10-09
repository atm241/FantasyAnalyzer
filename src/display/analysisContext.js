/**
 * Lazily computed analysis, shared by the menu screens.
 *
 * The full report recomputed everything on every run, which cost about one and
 * three quarter seconds - most of it spent scoring the entire waiver wire for a
 * screen you might not open. Each piece here is computed the first time it is
 * asked for and then reused.
 */
export class AnalysisContext {
  constructor({ services, league, user, roster, contention }) {
    this.services = services;
    this.league = league;
    this.user = user;
    this.roster = roster;
    this.contention = contention;
    this.pending = new Map();
  }

  /** Compute once, reuse thereafter. Failures are not cached. */
  async get(key) {
    if (!this.pending.has(key)) {
      const work = this.compute(key).catch(error => {
        this.pending.delete(key);
        throw error;
      });
      this.pending.set(key, work);
    }
    return this.pending.get(key);
  }

  /** Whether a piece has already been computed, for labelling the menu. */
  has(key) {
    return this.pending.has(key);
  }

  compute(key) {
    const { services, league, user, roster } = this;
    const leagueId = league.league_id;

    switch (key) {
      case 'formatted':
        return services.rosterService.formatRoster(roster, leagueId);

      case 'matchup':
        return services.gameday.getLiveMatchup(leagueId, user.user_id);

      case 'lineup':
        return services.optimizer.analyzeLineup(leagueId, roster);

      case 'needs':
        return this.get('byes').then(byes =>
          services.waiverAnalyzer.analyzeRosterNeeds(
            leagueId, roster, user.user_id, this.contention, byes
          )
        );

      // The expensive one: scoring every available player at every position.
      case 'board':
        return services.waiverAnalyzer.getTopAvailable(
          leagueId, 5, roster, user.user_id, this.contention
        );

      case 'trending':
        return services.waiverAnalyzer.getTrendingAvailable(leagueId);

      case 'drops':
        return this.get('formatted').then(formatted =>
          services.firstToGo.analyzeFirstToGo(
            formatted, this.week, leagueId, this.contention
          )
        );

      case 'byes':
        return Promise.all([
          this.get('formatted'),
          services.rosterService.getRosterPositions(leagueId),
          services.rosterService.getRestOfSeasonOutlook(leagueId)
        ]).then(([formatted, rosterPositions, outlook]) =>
          services.buildByeOutlook({
            roster: [...formatted.starters, ...formatted.bench],
            rosterPositions,
            outlook
          })
        );

      case 'standings':
        return services.standings.analyzeStandings(user.user_id, leagueId);

      case 'trades':
        return this.get('formatted').then(formatted =>
          services.tradeAnalyzer.findTradeMatches(
            formatted, leagueId, user.user_id, this.contention
          )
        );

      case 'tradeNeeds':
        return Promise.all([
          this.get('formatted'),
          services.rosterService.getEconomics(leagueId, roster)
        ]).then(([formatted, economics]) =>
          services.tradeAnalyzer.calculateTeamNeeds(formatted, economics)
        );

      case 'watchlist':
        return services.rosterService.getEconomics(leagueId, roster).then(economics =>
          services.watchlist.evaluate(leagueId, user.user_id, economics, this.contention)
        );

      case 'summary':
        return Promise.all([
          this.get('lineup'), this.get('needs'), this.get('trending'), this.get('board')
        ]).then(([lineup, needs, trending, board]) =>
          services.aiSummary.generateTeamSummary(
            user.user_id, this.league.league_id, lineup, needs, trending, board
          )
        );

      default:
        return Promise.resolve(null);
    }
  }
}

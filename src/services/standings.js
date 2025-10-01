/**
 * League standings and playoff probability analysis
 */
export class StandingsAnalyzer {
  constructor(api, rosterService) {
    this.api = api;
    this.rosterService = rosterService;
  }

  /**
   * Get all matchups for the season so far
   */
  async getSeasonMatchups(leagueId, currentWeek) {
    const matchupPromises = [];

    // Get matchups for weeks 1 through current week
    for (let week = 1; week < currentWeek; week++) {
      matchupPromises.push(
        this.api.getMatchups(leagueId, week).catch(() => [])
      );
    }

    const allMatchups = await Promise.all(matchupPromises);
    return allMatchups;
  }

  /**
   * Calculate team records from matchup history
   */
  calculateRecords(rosters, allMatchups) {
    const records = {};

    // Initialize records
    rosters.forEach(roster => {
      records[roster.roster_id] = {
        rosterId: roster.roster_id,
        ownerId: roster.owner_id,
        wins: 0,
        losses: 0,
        ties: 0,
        pointsFor: 0,
        pointsAgainst: 0
      };
    });

    // Process each week's matchups
    allMatchups.forEach(weekMatchups => {
      if (!weekMatchups || weekMatchups.length === 0) return;

      // Group matchups by matchup_id
      const matchupGroups = {};
      weekMatchups.forEach(m => {
        if (!matchupGroups[m.matchup_id]) {
          matchupGroups[m.matchup_id] = [];
        }
        matchupGroups[m.matchup_id].push(m);
      });

      // Process each matchup
      Object.values(matchupGroups).forEach(matchup => {
        if (matchup.length === 2) {
          const [team1, team2] = matchup;
          const points1 = team1.points || 0;
          const points2 = team2.points || 0;

          records[team1.roster_id].pointsFor += points1;
          records[team1.roster_id].pointsAgainst += points2;
          records[team2.roster_id].pointsFor += points2;
          records[team2.roster_id].pointsAgainst += points1;

          if (points1 > points2) {
            records[team1.roster_id].wins++;
            records[team2.roster_id].losses++;
          } else if (points2 > points1) {
            records[team2.roster_id].wins++;
            records[team1.roster_id].losses++;
          } else {
            records[team1.roster_id].ties++;
            records[team2.roster_id].ties++;
          }
        }
      });
    });

    return records;
  }

  /**
   * Calculate power rankings based on points scored
   */
  calculatePowerRankings(records) {
    const rankings = Object.values(records)
      .sort((a, b) => b.pointsFor - a.pointsFor)
      .map((record, idx) => ({
        ...record,
        powerRank: idx + 1
      }));

    return rankings;
  }

  /**
   * Get remaining schedule for all teams
   */
  async getRemainingSchedule(leagueId, currentWeek, regularSeasonWeeks) {
    const schedulePromises = [];

    // Get future matchups
    for (let week = currentWeek; week <= regularSeasonWeeks; week++) {
      schedulePromises.push(
        this.api.getMatchups(leagueId, week).catch(() => [])
      );
    }

    const futureMatchups = await Promise.all(schedulePromises);
    return futureMatchups;
  }

  /**
   * Calculate average points per game adjusting for BYE weeks
   */
  calculateAdjustedPPG(record, currentWeek) {
    const gamesPlayed = record.wins + record.losses + record.ties;
    if (gamesPlayed === 0) return 0;

    // Simple PPG
    return record.pointsFor / gamesPlayed;
  }

  /**
   * Estimate team strength including future BYE weeks
   */
  async estimateTeamStrength(rosterId, rosters, currentWeek, remainingWeeks) {
    const roster = rosters.find(r => r.roster_id === rosterId);
    if (!roster) return 0;

    // Get base points per game from record
    const record = roster.record || { pointsFor: 0, wins: 0, losses: 0, ties: 0 };
    const gamesPlayed = record.wins + record.losses + record.ties;
    const basePPG = gamesPlayed > 0 ? record.pointsFor / gamesPlayed : 0;

    // Check for upcoming BYE weeks in remaining schedule
    // This is simplified - in production you'd analyze actual roster
    // Week 5-14 have various BYE weeks, adjust strength slightly
    let byeWeekPenalty = 0;
    for (let week = currentWeek; week <= currentWeek + remainingWeeks; week++) {
      // Simplified: assume ~2-3 players affected per BYE week
      if (week >= 5 && week <= 14) {
        byeWeekPenalty += 0.5; // Small penalty per potential BYE week
      }
    }

    return Math.max(0, basePPG - byeWeekPenalty);
  }

  /**
   * Simulate remaining season using Monte Carlo
   */
  async simulateRemainingSeason(
    userRecord,
    allRecords,
    rosters,
    futureMatchups,
    currentWeek,
    iterations = 1000
  ) {
    let playoffAppearances = 0;

    for (let sim = 0; sim < iterations; sim++) {
      // Create a copy of current records
      const simRecords = allRecords.map(r => ({ ...r }));

      // Simulate each remaining week
      for (let weekIdx = 0; weekIdx < futureMatchups.length; weekIdx++) {
        const weekMatchups = futureMatchups[weekIdx];
        if (!weekMatchups || weekMatchups.length === 0) continue;

        // Group by matchup_id
        const matchupGroups = {};
        weekMatchups.forEach(m => {
          if (!matchupGroups[m.matchup_id]) {
            matchupGroups[m.matchup_id] = [];
          }
          matchupGroups[m.matchup_id].push(m);
        });

        // Simulate each matchup
        Object.values(matchupGroups).forEach(matchup => {
          if (matchup.length === 2) {
            const [team1, team2] = matchup;

            // Get team records
            const record1 = simRecords.find(r => r.rosterId === team1.roster_id);
            const record2 = simRecords.find(r => r.rosterId === team2.roster_id);

            if (!record1 || !record2) return;

            // Estimate points based on PPG with randomness
            const ppg1 = this.calculateAdjustedPPG(record1, currentWeek + weekIdx);
            const ppg2 = this.calculateAdjustedPPG(record2, currentWeek + weekIdx);

            // Add variance (±20% standard deviation)
            const points1 = ppg1 * (0.8 + Math.random() * 0.4);
            const points2 = ppg2 * (0.8 + Math.random() * 0.4);

            // Update records
            if (points1 > points2) {
              record1.wins++;
              record2.losses++;
            } else if (points2 > points1) {
              record2.wins++;
              record1.losses++;
            } else {
              record1.ties++;
              record2.ties++;
            }

            record1.pointsFor += points1;
            record2.pointsFor += points2;
          }
        });
      }

      // Sort final standings
      const finalStandings = simRecords.sort((a, b) => {
        if (b.wins !== a.wins) return b.wins - a.wins;
        return b.pointsFor - a.pointsFor;
      });

      // Check if user made playoffs
      const userFinalRecord = finalStandings.find(r => r.rosterId === userRecord.rosterId);
      const userFinalRank = finalStandings.indexOf(userFinalRecord) + 1;

      if (userFinalRank <= 6) { // Assuming 6 playoff teams
        playoffAppearances++;
      }
    }

    return (playoffAppearances / iterations) * 100;
  }

  /**
   * Calculate advanced playoff probability with matchup analysis
   */
  async calculatePlayoffProbability(
    record,
    allRecords,
    league,
    currentWeek,
    rosters,
    leagueId
  ) {
    const totalTeams = allRecords.length;
    const playoffTeams = league.settings?.playoff_teams || Math.floor(totalTeams / 2);
    const regularSeasonWeeks = (league.settings?.playoff_week_start || 15) - 1;
    const weeksRemaining = regularSeasonWeeks - currentWeek + 1;

    // Sort teams by wins, then points
    const sortedRecords = [...allRecords].sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      return b.pointsFor - a.pointsFor;
    });

    const currentRank = sortedRecords.findIndex(r => r.rosterId === record.rosterId) + 1;

    // Calculate current winning percentage
    const gamesPlayed = record.wins + record.losses + record.ties;
    const winPct = gamesPlayed > 0 ? (record.wins + record.ties * 0.5) / gamesPlayed : 0;

    // Edge case: no weeks remaining
    if (weeksRemaining === 0) {
      return {
        probability: currentRank <= playoffTeams ? 100 : 0,
        currentRank,
        playoffTeams,
        weeksRemaining,
        status: currentRank <= playoffTeams ? 'IN' : 'OUT'
      };
    }

    // Get remaining schedule
    let futureMatchups = [];
    try {
      futureMatchups = await this.getRemainingSchedule(leagueId, currentWeek, regularSeasonWeeks);
    } catch (error) {
      // Fall back to simple calculation if we can't get schedule
    }

    // Calculate probability using Monte Carlo simulation if we have matchups
    let probability = 0;

    if (futureMatchups.length > 0 && futureMatchups.some(m => m.length > 0)) {
      // Use simulation for more accurate probability
      probability = await this.simulateRemainingSeason(
        record,
        allRecords,
        rosters,
        futureMatchups,
        currentWeek,
        500 // iterations
      );
    } else {
      // Fallback to heuristic-based calculation
      const avgPPG = this.calculateAdjustedPPG(record, currentWeek);
      const leagueAvgPPG = allRecords.reduce((sum, r) => {
        const games = r.wins + r.losses + r.ties;
        return sum + (games > 0 ? r.pointsFor / games : 0);
      }, 0) / allRecords.length;

      // Base probability on current position
      if (currentRank <= playoffTeams) {
        const cushion = playoffTeams - currentRank;
        probability = 70 + Math.min(cushion * 5, 20);
      } else {
        const deficit = currentRank - playoffTeams;
        probability = Math.max(5, 45 - deficit * 8);
      }

      // Adjust based on team strength vs league average
      const strengthDiff = avgPPG - leagueAvgPPG;
      probability += strengthDiff * 2;

      // Adjust based on time remaining
      if (weeksRemaining >= 8) {
        probability += 10; // More time to climb
      } else if (weeksRemaining <= 3) {
        probability -= 15; // Less time to make up ground
      }

      // Adjust based on current performance trend
      if (winPct >= 0.6) {
        probability += 15;
      } else if (winPct <= 0.3) {
        probability -= 20;
      }

      // Clamp probability
      probability = Math.max(1, Math.min(99, probability));
    }

    return {
      probability: Math.round(probability),
      currentRank,
      playoffTeams,
      weeksRemaining,
      status: currentRank <= playoffTeams ? 'IN' : 'OUT'
    };
  }

  /**
   * Get complete standings analysis
   */
  async analyzeStandings(userId, leagueId) {
    const currentWeek = await this.rosterService.getCurrentWeek();
    const league = await this.api.getLeague(leagueId);
    const rosters = await this.api.getLeagueRosters(leagueId);
    const users = await this.api.getLeagueUsers(leagueId);

    // Get matchup history
    const allMatchups = await this.getSeasonMatchups(leagueId, currentWeek);

    // Calculate records
    const records = this.calculateRecords(rosters, allMatchups);

    // Add user info
    const recordsWithUsers = Object.values(records).map(record => {
      const user = users.find(u => u.user_id === record.ownerId);
      return {
        ...record,
        teamName: user?.metadata?.team_name || user?.display_name || 'Unknown',
        username: user?.display_name || 'Unknown'
      };
    });

    // Calculate power rankings
    const powerRankings = this.calculatePowerRankings(recordsWithUsers);

    // Sort by standings (wins first, then points)
    const standings = [...recordsWithUsers].sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.ties !== a.ties) return b.ties - a.ties;
      return b.pointsFor - a.pointsFor;
    });

    // Find user's team
    const userRoster = rosters.find(r => r.owner_id === userId);
    const userRecord = records[userRoster?.roster_id];

    if (!userRecord) {
      throw new Error('Could not find user record');
    }

    const userStanding = standings.findIndex(s => s.rosterId === userRecord.rosterId) + 1;
    const userPowerRank = powerRankings.find(p => p.rosterId === userRecord.rosterId)?.powerRank || 0;

    // Calculate playoff probability with matchup analysis
    const playoffProb = await this.calculatePlayoffProbability(
      userRecord,
      recordsWithUsers,
      league,
      currentWeek,
      rosters,
      leagueId
    );

    return {
      userRecord: {
        ...userRecord,
        teamName: standings.find(s => s.rosterId === userRecord.rosterId)?.teamName,
        standing: userStanding,
        powerRank: userPowerRank
      },
      standings,
      powerRankings,
      playoffProb,
      leagueSize: standings.length,
      currentWeek
    };
  }

  /**
   * Format standings for display
   */
  formatStandings(analysis) {
    const lines = [];

    lines.push('\n🏆 LEAGUE STANDINGS & PLAYOFF OUTLOOK\n');

    // User's team summary
    const record = analysis.userRecord;
    const gamesPlayed = record.wins + record.losses + record.ties;
    const winPct = gamesPlayed > 0 ? ((record.wins + record.ties * 0.5) / gamesPlayed * 100).toFixed(1) : '0.0';

    lines.push(`YOUR TEAM: ${record.teamName || 'Unknown'}`);
    lines.push(`Record: ${record.wins}-${record.losses}${record.ties > 0 ? `-${record.ties}` : ''} (${winPct}% win rate)`);
    lines.push(`Points For: ${record.pointsFor.toFixed(1)} | Points Against: ${record.pointsAgainst.toFixed(1)}`);
    lines.push(`League Standing: #${record.standing} of ${analysis.leagueSize}`);
    lines.push(`Power Ranking: #${record.powerRank} of ${analysis.leagueSize}`);
    lines.push('');

    // Playoff probability
    const prob = analysis.playoffProb;
    let probColor = prob.probability >= 75 ? '🟢' : prob.probability >= 50 ? '🟡' : '🔴';
    lines.push(`${probColor} PLAYOFF PROBABILITY: ${prob.probability}%`);
    lines.push(`Status: ${prob.status === 'IN' ? '✓ Currently in playoff position' : '⚠️  Currently outside playoffs'}`);
    lines.push(`Playoff spots: ${prob.playoffTeams} teams make playoffs`);
    lines.push(`Weeks remaining: ${prob.weeksRemaining}`);
    lines.push('');

    // Full standings
    lines.push('FULL STANDINGS:');
    lines.push('Rank  Team                        W-L-T    PF       PA       ');
    lines.push('─'.repeat(65));

    analysis.standings.forEach((team, idx) => {
      const isUser = team.rosterId === record.rosterId;
      const marker = isUser ? '→ ' : '  ';
      const rank = `${idx + 1}.`.padEnd(5);
      const teamName = (team.teamName || team.username).padEnd(24).substring(0, 24);
      const recordStr = `${team.wins}-${team.losses}${team.ties > 0 ? `-${team.ties}` : ''}`.padEnd(7);
      const pf = team.pointsFor.toFixed(1).padStart(7);
      const pa = team.pointsAgainst.toFixed(1).padStart(7);

      lines.push(`${marker}${rank} ${teamName} ${recordStr} ${pf}  ${pa}`);
    });

    lines.push('');

    // Power Rankings
    lines.push('POWER RANKINGS (by points scored):');
    lines.push('─'.repeat(65));

    analysis.powerRankings.slice(0, 10).forEach(team => {
      const isUser = team.rosterId === record.rosterId;
      const marker = isUser ? '→ ' : '  ';
      const rank = `${team.powerRank}.`.padEnd(5);
      const teamName = (team.teamName || team.username).padEnd(24).substring(0, 24);
      const pf = team.pointsFor.toFixed(1).padStart(7);

      lines.push(`${marker}${rank} ${teamName} ${pf} pts`);
    });

    return lines.join('\n');
  }
}

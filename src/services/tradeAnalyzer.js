/**
 * Analyze trade opportunities by matching team needs
 */
export class TradeAnalyzer {
  constructor(rosterService) {
    this.rosterService = rosterService;
  }

  /**
   * Calculate positional needs for a team
   * Returns surplus (excess) and deficit (need) positions
   */
  calculateTeamNeeds(roster) {
    const positionDepth = {};
    const allPlayers = [...roster.starters, ...roster.bench];

    // Count players by position
    allPlayers.forEach(player => {
      positionDepth[player.position] = (positionDepth[player.position] || 0) + 1;
    });

    // Define ideal roster composition
    const idealDepth = {
      'QB': 2,
      'RB': 4,
      'WR': 5,
      'TE': 2,
      'K': 1,
      'DEF': 1
    };

    const surplus = {};
    const deficit = {};

    for (const [position, count] of Object.entries(positionDepth)) {
      const ideal = idealDepth[position] || 0;
      const diff = count - ideal;

      if (diff > 1 && !['K', 'DEF'].includes(position)) {
        surplus[position] = {
          count,
          ideal,
          excess: diff
        };
      } else if (diff < 0) {
        deficit[position] = {
          count,
          ideal,
          shortage: Math.abs(diff)
        };
      }
    }

    return { surplus, deficit, positionDepth };
  }

  /**
   * Calculate player trade value based on projections and scarcity
   */
  calculatePlayerTradeValue(player, positionDepth, isStarter = false) {
    let value = 50; // Base value

    // Starter bonus
    if (isStarter) value += 25;

    // Position scarcity multiplier
    const scarcityValue = {
      'QB': 1.0,
      'RB': 1.3,  // RBs more valuable due to scarcity
      'WR': 1.1,
      'TE': 1.2,
      'K': 0.3,
      'DEF': 0.3
    };
    value *= (scarcityValue[player.position] || 1.0);

    // Injury penalty
    if (player.injuryStatus === 'Out') value *= 0.3;
    if (player.injuryStatus === 'Doubtful') value *= 0.5;
    if (player.injuryStatus === 'Questionable') value *= 0.85;
    if (player.injuryStatus === 'IR') value *= 0.1;

    // Bye week slight penalty
    if (player.onBye) value *= 0.95;

    // Team quality bonus/penalty
    const eliteOffenses = ['KC', 'SF', 'BAL', 'BUF', 'MIA', 'DAL', 'PHI', 'DET'];
    const weakOffenses = ['CAR', 'NE', 'TEN', 'NYG', 'LV', 'JAX', 'CHI'];

    if (eliteOffenses.includes(player.team)) value *= 1.15;
    if (weakOffenses.includes(player.team)) value *= 0.85;

    return Math.round(value);
  }

  /**
   * Find trade matches between your team and other teams
   */
  async findTradeMatches(yourRoster, leagueId, yourUserId) {
    // Get all league rosters and users
    const allRosters = await this.rosterService.api.getLeagueRosters(leagueId);
    const allUsers = await this.rosterService.api.getLeagueUsers(leagueId);
    const allPlayers = await this.rosterService.loadPlayers();

    // Analyze your team's needs
    const yourNeeds = this.calculateTeamNeeds(yourRoster);

    // Format your roster with player details
    const yourFormattedRoster = await this.rosterService.formatRoster(
      allRosters.find(r => r.owner_id === yourUserId)
    );

    const tradeMatches = [];

    // Analyze each opponent
    for (const opponentRoster of allRosters) {
      if (opponentRoster.owner_id === yourUserId) continue; // Skip your own team

      // Format opponent roster
      const opponentFormatted = await this.rosterService.formatRoster(opponentRoster);
      const opponentNeeds = this.calculateTeamNeeds(opponentFormatted);

      // Find complementary needs (you have surplus where they have deficit, vice versa)
      const matches = this.findComplementaryNeeds(
        yourNeeds,
        opponentNeeds,
        yourFormattedRoster,
        opponentFormatted,
        opponentRoster
      );

      if (matches.length > 0) {
        // Get opponent user info
        const opponentUser = allUsers.find(u => u.user_id === opponentRoster.owner_id);
        const displayName = opponentUser?.display_name ||
                           opponentUser?.metadata?.team_name ||
                           `Team ${opponentRoster.roster_id}`;

        tradeMatches.push({
          teamId: opponentRoster.roster_id,
          ownerId: opponentRoster.owner_id,
          username: displayName,
          record: `${opponentRoster.settings?.wins || 0}-${opponentRoster.settings?.losses || 0}`,
          matches
        });
      }
    }

    // Sort by match quality (number of good matches)
    tradeMatches.sort((a, b) => b.matches.length - a.matches.length);

    return tradeMatches;
  }

  /**
   * Find complementary trade opportunities between two teams
   */
  findComplementaryNeeds(yourNeeds, theirNeeds, yourRoster, theirRoster, theirRosterData) {
    const matches = [];

    // Check if you have surplus in a position they need
    for (const [position, surplusInfo] of Object.entries(yourNeeds.surplus)) {
      if (theirNeeds.deficit[position]) {
        // You have excess, they have shortage - good trade opportunity!

        // Get your tradeable players at this position (mid-tier, not your best or worst)
        const yourPositionPlayers = [...yourRoster.starters, ...yourRoster.bench]
          .filter(p => p.position === position)
          .map(p => ({
            ...p,
            tradeValue: this.calculatePlayerTradeValue(
              p,
              yourNeeds.positionDepth,
              yourRoster.starters.some(s => s.playerId === p.playerId)
            )
          }))
          .sort((a, b) => b.tradeValue - a.tradeValue);

        // Get their players you might want in return
        const theirSurplusPositions = Object.keys(theirNeeds.surplus);
        const yourDeficitPositions = Object.keys(yourNeeds.deficit);

        // Find positions where they have surplus and you have deficit
        const returnPositions = theirSurplusPositions.filter(pos =>
          yourDeficitPositions.includes(pos)
        );

        if (yourPositionPlayers.length >= 3) {
          // Offer your 2nd or 3rd best player (keep your best, don't trade your worst)
          const tradeablePlayer = yourPositionPlayers[1] || yourPositionPlayers[2];

          if (tradeablePlayer && tradeablePlayer.tradeValue > 30) {
            matches.push({
              yourPlayer: tradeablePlayer,
              theirNeed: position,
              theirDeficit: theirNeeds.deficit[position].shortage,
              returnPositions: returnPositions.length > 0 ? returnPositions : null,
              matchScore: this.calculateMatchScore(
                surplusInfo,
                theirNeeds.deficit[position],
                returnPositions.length
              )
            });
          }
        }
      }
    }

    // Sort matches by quality
    matches.sort((a, b) => b.matchScore - a.matchScore);

    return matches.slice(0, 3); // Top 3 matches per team
  }

  /**
   * Calculate how good a trade match is (0-100)
   */
  calculateMatchScore(yourSurplus, theirDeficit, returnPositionsCount) {
    let score = 50; // Base score

    // More excess = better trade opportunity
    score += yourSurplus.excess * 10;

    // Their shortage severity
    score += theirDeficit.shortage * 15;

    // Bonus if they have positions you need
    score += returnPositionsCount * 20;

    return Math.min(100, score);
  }

  /**
   * Format trade analysis for display
   */
  formatTradeAnalysis(tradeMatches, yourNeeds) {
    const lines = [];

    lines.push('\n🤝 TRADE OPPORTUNITIES\n');

    if (tradeMatches.length === 0) {
      lines.push('No obvious trade matches found based on team needs.\n');
      return lines.join('\n');
    }

    lines.push('Teams with complementary needs:\n');

    tradeMatches.forEach((match, idx) => {
      if (idx >= 5) return; // Show top 5 teams

      lines.push(`\n${idx + 1}. ${match.username} (${match.record})`);
      lines.push(`   ${match.matches.length} potential trade match${match.matches.length > 1 ? 'es' : ''}`);

      match.matches.forEach(m => {
        const returnInfo = m.returnPositions && m.returnPositions.length > 0
          ? ` → Target their ${m.returnPositions.join('/')}`
          : '';

        lines.push(`   • Offer: ${m.yourPlayer.name} (${m.yourPlayer.position}) - Value: ${m.yourPlayer.tradeValue}`);
        lines.push(`     Why: They need ${m.theirNeed} (${m.theirDeficit} short)${returnInfo}`);
        lines.push(`     Match Quality: ${m.matchScore}/100`);
      });
    });

    // Show your team's needs summary
    lines.push('\n\n📋 YOUR TEAM NEEDS SUMMARY\n');

    if (Object.keys(yourNeeds.surplus).length > 0) {
      lines.push('Surplus Positions (trade away):');
      for (const [pos, info] of Object.entries(yourNeeds.surplus)) {
        lines.push(`  • ${pos}: ${info.count} players (+${info.excess} over ideal)`);
      }
    }

    if (Object.keys(yourNeeds.deficit).length > 0) {
      lines.push('\nNeeded Positions (trade for):');
      for (const [pos, info] of Object.entries(yourNeeds.deficit)) {
        lines.push(`  • ${pos}: ${info.count} players (-${info.shortage} below ideal)`);
      }
    }

    return lines.join('\n');
  }
}

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

        // Generate specific trade proposals
        const proposals = this.generateTradeProposal(
          yourFormattedRoster,
          opponentFormatted,
          yourNeeds,
          opponentNeeds
        );

        tradeMatches.push({
          teamId: opponentRoster.roster_id,
          ownerId: opponentRoster.owner_id,
          username: displayName,
          record: `${opponentRoster.settings?.wins || 0}-${opponentRoster.settings?.losses || 0}`,
          matches,
          proposals
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
   * Generate specific trade proposals between teams
   */
  generateTradeProposal(yourRoster, theirRoster, yourNeeds, theirNeeds) {
    const proposals = [];

    // For each position where you have surplus and they have deficit
    for (const [position, surplusInfo] of Object.entries(yourNeeds.surplus)) {
      if (!theirNeeds.deficit[position]) continue;

      // Get your players at this position (sorted by value)
      const yourPositionPlayers = [...yourRoster.starters, ...yourRoster.bench]
        .filter(p => p.position === position)
        .map(p => ({
          ...p,
          tradeValue: this.calculatePlayerTradeValue(
            p,
            yourNeeds.positionDepth,
            yourRoster.starters.some(s => s.playerId === p.playerId)
          ),
          restOfSeasonPoints: this.estimateRestOfSeasonPoints(p, 8) // ~8 weeks left
        }))
        .sort((a, b) => b.tradeValue - a.tradeValue);

      if (yourPositionPlayers.length < 3) continue;

      // Offer your 2nd or 3rd best (keep your #1, don't trade worst)
      const playerToOffer = yourPositionPlayers[1] || yourPositionPlayers[2];
      if (!playerToOffer || playerToOffer.tradeValue < 30) continue;

      // Find positions where they have surplus and you have deficit
      const returnPositions = Object.keys(theirNeeds.surplus).filter(pos =>
        yourNeeds.deficit[pos]
      );

      if (returnPositions.length === 0) {
        // If no direct swap, look for any position where they're strong
        returnPositions.push(...Object.keys(theirNeeds.surplus));
      }

      // Get their players at return positions
      for (const returnPos of returnPositions) {
        const theirPositionPlayers = [...theirRoster.starters, ...theirRoster.bench]
          .filter(p => p.position === returnPos)
          .map(p => ({
            ...p,
            tradeValue: this.calculatePlayerTradeValue(
              p,
              theirNeeds.positionDepth,
              theirRoster.starters.some(s => s.playerId === p.playerId)
            ),
            restOfSeasonPoints: this.estimateRestOfSeasonPoints(p, 8)
          }))
          .sort((a, b) => b.tradeValue - a.tradeValue);

        if (theirPositionPlayers.length < 2) continue;

        // Find fair trades (value within 20% of each other)
        const yourValue = playerToOffer.tradeValue;

        for (const theirPlayer of theirPositionPlayers.slice(0, 3)) {
          const valueDiff = Math.abs(yourValue - theirPlayer.tradeValue);
          const valueRatio = valueDiff / Math.max(yourValue, theirPlayer.tradeValue);

          // If values are close, propose 1-for-1
          if (valueRatio < 0.2) {
            proposals.push(this.createTradeProposal(
              [playerToOffer],
              [theirPlayer],
              'Fair 1-for-1 swap'
            ));
          }
          // If they're getting less value, add another player
          else if (yourValue > theirPlayer.tradeValue * 1.3) {
            const additionalPlayer = theirPositionPlayers.find(p =>
              p.playerId !== theirPlayer.playerId &&
              (yourValue - (theirPlayer.tradeValue + p.tradeValue)) < yourValue * 0.15
            );

            if (additionalPlayer) {
              proposals.push(this.createTradeProposal(
                [playerToOffer],
                [theirPlayer, additionalPlayer],
                'You get more value'
              ));
            }
          }
        }
      }
    }

    return proposals.slice(0, 3); // Top 3 proposals
  }

  /**
   * Create a structured trade proposal with evaluation
   */
  createTradeProposal(yourPlayers, theirPlayers, tradeType) {
    const yourValue = yourPlayers.reduce((sum, p) => sum + p.tradeValue, 0);
    const theirValue = theirPlayers.reduce((sum, p) => sum + p.tradeValue, 0);

    const yourPoints = yourPlayers.reduce((sum, p) => sum + p.restOfSeasonPoints, 0);
    const theirPoints = theirPlayers.reduce((sum, p) => sum + p.restOfSeasonPoints, 0);

    const pointsDiff = theirPoints - yourPoints;
    const valueDiff = theirValue - yourValue;

    return {
      youGive: yourPlayers,
      youGet: theirPlayers,
      tradeType,
      yourTotalValue: yourValue,
      theirTotalValue: theirValue,
      valueDiff,
      yourProjectedPoints: yourPoints,
      theirProjectedPoints: theirPoints,
      projectedPointsGain: pointsDiff,
      winner: pointsDiff > 5 ? 'you' : pointsDiff < -5 ? 'them' : 'fair'
    };
  }

  /**
   * Estimate rest of season points for a player
   */
  estimateRestOfSeasonPoints(player, weeksRemaining = 8) {
    // Base weekly points by position
    const basePoints = {
      'QB': 18,
      'RB': 12,
      'WR': 11,
      'TE': 9,
      'K': 8,
      'DEF': 8
    };

    let weeklyPoints = basePoints[player.position] || 0;

    // Apply quality multiplier (similar to optimizer)
    const scarcityValue = {
      'QB': 1.0,
      'RB': 1.3,
      'WR': 1.1,
      'TE': 1.2,
      'K': 0.3,
      'DEF': 0.3
    };
    weeklyPoints *= (scarcityValue[player.position] || 1.0);

    // Team quality
    const eliteOffenses = ['KC', 'SF', 'BAL', 'BUF', 'MIA', 'DAL', 'PHI', 'DET'];
    const weakOffenses = ['CAR', 'NE', 'TEN', 'NYG', 'LV', 'JAX', 'CHI'];

    if (eliteOffenses.includes(player.team)) weeklyPoints *= 1.15;
    if (weakOffenses.includes(player.team)) weeklyPoints *= 0.85;

    // Injury penalty
    if (player.injuryStatus === 'Out') weeklyPoints *= 0.3;
    if (player.injuryStatus === 'Doubtful') weeklyPoints *= 0.5;
    if (player.injuryStatus === 'Questionable') weeklyPoints *= 0.9;

    // Account for potential bye week in remaining weeks
    const byeWeekAdjustment = (weeksRemaining - 1) / weeksRemaining;

    return Math.round(weeklyPoints * weeksRemaining * byeWeekAdjustment);
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
      if (idx >= 3) return; // Show top 3 teams with proposals

      lines.push(`\n${'='.repeat(70)}`);
      lines.push(`${idx + 1}. ${match.username} (${match.record})`);
      lines.push(`${'='.repeat(70)}`);

      // Show specific trade proposals if available
      if (match.proposals && match.proposals.length > 0) {
        lines.push('\n💡 RECOMMENDED TRADES:\n');

        match.proposals.forEach((proposal, pidx) => {
          lines.push(`Trade ${pidx + 1}: ${proposal.tradeType}`);

          // What you give
          lines.push('  📤 You Give:');
          proposal.youGive.forEach(p => {
            lines.push(`     - ${p.name} (${p.position}) ${p.team}`);
            lines.push(`       Value: ${p.tradeValue} | ROS Points: ${p.restOfSeasonPoints}`);
          });

          // What you get
          lines.push('  📥 You Get:');
          proposal.youGet.forEach(p => {
            lines.push(`     - ${p.name} (${p.position}) ${p.team}`);
            lines.push(`       Value: ${p.tradeValue} | ROS Points: ${p.restOfSeasonPoints}`);
          });

          // Trade evaluation
          lines.push('\n  📊 Trade Evaluation:');
          lines.push(`     Total Value: You ${proposal.yourTotalValue} vs Them ${proposal.theirTotalValue}`);
          lines.push(`     ROS Points: You ${proposal.yourProjectedPoints} vs Them ${proposal.theirProjectedPoints}`);

          const winnerText = proposal.winner === 'you'
            ? `✅ YOU WIN by ${proposal.projectedPointsGain} points`
            : proposal.winner === 'them'
            ? `⚠️  THEY WIN by ${Math.abs(proposal.projectedPointsGain)} points`
            : '🤝 FAIR TRADE (even value)';

          lines.push(`     Winner: ${winnerText}\n`);
        });
      } else {
        // Fallback to basic match info
        lines.push(`\n   ${match.matches.length} potential trade match${match.matches.length > 1 ? 'es' : ''}`);

        match.matches.forEach(m => {
          const returnInfo = m.returnPositions && m.returnPositions.length > 0
            ? ` → Target their ${m.returnPositions.join('/')}`
            : '';

          lines.push(`   • Offer: ${m.yourPlayer.name} (${m.yourPlayer.position}) - Value: ${m.yourPlayer.tradeValue}`);
          lines.push(`     Why: They need ${m.theirNeed} (${m.theirDeficit} short)${returnInfo}`);
          lines.push(`     Match Quality: ${m.matchScore}/100`);
        });
      }
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

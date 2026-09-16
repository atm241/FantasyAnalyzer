import { getTeamsOnBye, hasByeData } from '../data/nflSchedule.js';

/**
 * AI-powered team analysis and strategic recommendations
 */
export class AISummaryService {
  constructor(rosterService) {
    this.rosterService = rosterService;
  }

  /**
   * Generate strategic recommendations based on roster analysis
   */
  async generateTeamSummary(userId, leagueId, lineupAnalysis, rosterNeeds, trendingPlayers, topAvailable) {
    const currentWeek = await this.rosterService.getCurrentWeek();

    // Analyze the data
    const summary = {
      week: currentWeek,
      pointsGain: lineupAnalysis.pointsGain || 0,
      criticalIssues: [],
      opportunities: [],
      lineupChanges: [],
      waiverTargets: [],
      strategicAdvice: []
    };

    // Check for BYE week issues
    const byePlayers = lineupAnalysis.currentLineup.filter(p => p.onBye);
    if (byePlayers.length > 0) {
      summary.criticalIssues.push({
        type: 'bye_week',
        severity: 'high',
        message: `${byePlayers.length} starter(s) on BYE this week`,
        players: byePlayers.map(p => `${p.name} (${p.position})`),
        action: 'Replace BYE week players in starting lineup or pickup temporary replacements'
      });
    }

    // Check for injured starters
    const injuredStarters = lineupAnalysis.currentLineup.filter(p =>
      ['Out', 'IR', 'Doubtful'].includes(p.injuryStatus)
    );
    if (injuredStarters.length > 0) {
      summary.criticalIssues.push({
        type: 'injuries',
        severity: 'high',
        message: `${injuredStarters.length} injured starter(s)`,
        players: injuredStarters.map(p => `${p.name} (${p.position}) - ${p.injuryStatus}`),
        action: 'Move to bench and start healthy players'
      });
    }

    // Lineup optimization opportunities
    if (lineupAnalysis.pointsGain > 1) {
      summary.opportunities.push({
        type: 'lineup_optimization',
        value: `+${lineupAnalysis.pointsGain.toFixed(1)} projected points`,
        message: 'Suboptimal lineup detected',
        action: 'Make recommended lineup changes below'
      });

      lineupAnalysis.recommendations.forEach(rec => {
        if (rec.type === 'swap') {
          // Bench-to-starter swap
          summary.lineupChanges.push({
            bench: `${rec.out.name} (${rec.out.position})`,
            benchProjection: rec.out.projection || 0,
            start: `${rec.in.name} (${rec.in.position})`,
            startProjection: rec.in.projection || 0,
            improvement: `+${rec.improvement.toFixed(1)} pts`,
            reason: rec.out.onBye ? 'On BYE' : rec.out.injuryStatus ? `Injured: ${rec.out.injuryStatus}` : 'Better matchup'
          });
        } else if (rec.type === 'position_swap') {
          // Position swap between two starters
          summary.lineupChanges.push({
            bench: `${rec.player.name} at ${rec.fromSlot}`,
            benchProjection: null,
            start: `${rec.player.name} at ${rec.toSlot}`,
            startProjection: rec.player.projection || 0,
            improvement: `+${rec.improvement.toFixed(1)} pts`,
            reason: 'Position optimization'
          });
        }
      });
    }

    // Roster depth issues
    if (rosterNeeds.weakPositions.length > 0) {
      const mostCritical = rosterNeeds.weakPositions.sort((a, b) => b.deficit - a.deficit)[0];
      summary.criticalIssues.push({
        type: 'roster_depth',
        severity: 'medium',
        message: `Weak depth at ${mostCritical.position}`,
        details: `Only ${mostCritical.current} player(s), recommend ${mostCritical.recommended}`,
        action: 'Target waiver pickups at this position'
      });

      // Add top waiver targets for weak positions
      rosterNeeds.weakPositions.forEach(weak => {
        const targets = rosterNeeds.targetedPickups[weak.position] || [];
        if (targets.length > 0) {
          summary.waiverTargets.push({
            position: weak.position,
            priority: weak.deficit >= 2 ? 'HIGH' : 'MEDIUM',
            topTargets: targets.slice(0, 3).map(p => ({
              name: p.name,
              team: p.team,
              score: p.waiverScore,
              onBye: p.onBye,
              trending: p.trending
            }))
          });
        }
      });
    }

    // Identify trending opportunities
    const trendingAvailable = trendingPlayers.filter(p => !p.onBye).slice(0, 3);
    if (trendingAvailable.length > 0) {
      summary.opportunities.push({
        type: 'trending_pickups',
        value: `${trendingAvailable.length} hot pickups available`,
        message: 'High-demand players on waivers',
        players: trendingAvailable.map(p => `${p.name} (${p.position}, ${p.team})`)
      });
    }

    // An unfilled starting slot scores zero - surface it above everything else.
    const emptySlots = (lineupAnalysis.currentLineup || []).filter(p => p.emptySlot);
    if (emptySlots.length > 0) {
      summary.criticalIssues.unshift({
        type: 'empty_slot',
        severity: 'high',
        message: `${emptySlots.length} empty starting slot(s)`,
        players: emptySlots.map(p => `${p.slotPosition || p.position} - nobody started`),
        action: 'Start someone - an empty slot scores 0 points'
      });
    }

    // Strategic advice
    if (currentWeek <= 8) {
      summary.strategicAdvice.push('Early season: Focus on building depth and identifying breakout players');
    } else if (currentWeek >= 14) {
      summary.strategicAdvice.push('Playoff push: Prioritize proven performers and favorable playoff schedules');
    } else {
      summary.strategicAdvice.push('Mid-season: Balance between depth and upside, prepare for playoff run');
    }

    // Add BYE week planning, but only when teams are actually on bye this week
    const teamsOnBye = getTeamsOnBye(currentWeek);
    if (teamsOnBye.length > 0) {
      summary.strategicAdvice.push(
        `Week ${currentWeek} BYE teams: ${teamsOnBye.join(', ')} - verify all starters are playing`
      );
    } else if (!hasByeData()) {
      summary.strategicAdvice.push('BYE week data unavailable - verify all starters are playing');
    }

    // Overall assessment
    const totalIssues = summary.criticalIssues.length;
    const pointsLost = lineupAnalysis.pointsGain;

    if (totalIssues === 0 && pointsLost < 1) {
      summary.overallAssessment = 'STRONG - Your team is well-positioned this week';
    } else if (totalIssues <= 1 && pointsLost < 3) {
      summary.overallAssessment = 'GOOD - Minor adjustments needed';
    } else if (totalIssues <= 2 || pointsLost < 5) {
      summary.overallAssessment = 'NEEDS ATTENTION - Several improvements available';
    } else {
      summary.overallAssessment = 'CRITICAL - Immediate action required';
    }

    return summary;
  }

  /**
   * Format summary as readable text
   */
  formatSummary(summary) {
    const lines = [];

    lines.push(`\n📊 WEEK ${summary.week} TEAM ANALYSIS`);
    lines.push(`Overall Status: ${summary.overallAssessment}\n`);

    // Critical Issues
    if (summary.criticalIssues.length > 0) {
      lines.push('🚨 CRITICAL ISSUES:');
      summary.criticalIssues.forEach((issue, idx) => {
        lines.push(`\n${idx + 1}. ${issue.message.toUpperCase()}`);
        if (issue.players) {
          issue.players.forEach(p => lines.push(`   - ${p}`));
        }
        if (issue.details) {
          lines.push(`   ${issue.details}`);
        }
        lines.push(`   ⚡ Action: ${issue.action}`);
      });
      lines.push('');
    }

    // Lineup changes are rendered in full by the LINEUP OPTIMIZATION section
    // above; repeating them here just made the report twice as long.
    if (summary.lineupChanges.length > 0) {
      lines.push(
        `🔄 LINEUP: ${summary.lineupChanges.length} change(s) available ` +
        `(+${summary.pointsGain.toFixed(1)} pts) - see LINEUP OPTIMIZATION above`
      );
      lines.push('');
    }

    // Waiver Targets
    if (summary.waiverTargets.length > 0) {
      lines.push('🎯 PRIORITY WAIVER TARGETS:');
      summary.waiverTargets.forEach(target => {
        lines.push(`\n${target.position} (${target.priority} PRIORITY):`);
        target.topTargets.forEach((player, idx) => {
          const badges = [];
          if (player.trending) badges.push('🔥 TRENDING');
          if (player.onBye) badges.push('BYE');
          const badgeStr = badges.length > 0 ? ` [${badges.join(', ')}]` : '';
          lines.push(`   ${idx + 1}. ${player.name} (${player.team}) - Score: ${player.score}${badgeStr}`);
        });
      });
      lines.push('');
    }

    // Opportunities
    if (summary.opportunities.length > 0) {
      lines.push('💡 OPPORTUNITIES:');
      summary.opportunities.forEach(opp => {
        lines.push(`\n• ${opp.message} (${opp.value})`);
        if (opp.players) {
          opp.players.forEach(p => lines.push(`  - ${p}`));
        }
      });
      lines.push('');
    }

    // Strategic Advice
    if (summary.strategicAdvice.length > 0) {
      lines.push('📋 STRATEGIC ADVICE:');
      summary.strategicAdvice.forEach(advice => {
        lines.push(`• ${advice}`);
      });
      lines.push('');
    }

    return lines.join('\n');
  }
}

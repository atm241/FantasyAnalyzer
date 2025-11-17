import { ROSTER_POSITION_VALUE } from '../data/scoringConstants.js';
import { WEAK_OFFENSES } from '../data/teamRankings.js';

/**
 * Identify players to drop or trade
 */
export class FirstToGoAnalyzer {
  constructor(rosterService) {
    this.rosterService = rosterService;
  }

  /**
   * Score player's roster value (0-100, lower = more droppable)
   */
  scorePlayerValue(player, positionDepth, isStarter = false) {
    let score = 50; // Base score

    // Starters get bonus
    if (isStarter) {
      score += 20;
    }

    // Position scarcity
    score += ROSTER_POSITION_VALUE[player.position] || 0;

    // Deep positions are less valuable
    if (positionDepth[player.position] > 4) {
      score -= 10;
    }

    // Injury/status penalties
    if (player.injuryStatus === 'IR') score -= 40;
    if (player.injuryStatus === 'Out') score -= 30;
    if (player.injuryStatus === 'Doubtful') score -= 20;
    if (player.injuryStatus === 'Questionable') score -= 5;

    // Team quality (players on bad teams less valuable)
    if (WEAK_OFFENSES.includes(player.team)) {
      score -= 10;
    }

    // BYE week consideration (slightly reduce value during bye)
    if (player.onBye) {
      score -= 5;
    }

    return Math.max(0, Math.min(100, score));
  }

  /**
   * Analyze roster for droppable and tradeable players
   */
  async analyzeFirstToGo(roster, currentWeek) {
    // Calculate position depth
    const positionDepth = {};
    const allPlayers = [...roster.starters, ...roster.bench];

    allPlayers.forEach(player => {
      positionDepth[player.position] = (positionDepth[player.position] || 0) + 1;
    });

    // Score all bench players
    const benchScored = roster.bench.map(player => ({
      ...player,
      value: this.scorePlayerValue(player, positionDepth, false),
      isStarter: false
    }));

    // Score starters (for trade value)
    const startersScored = roster.starters.map(player => ({
      ...player,
      value: this.scorePlayerValue(player, positionDepth, true),
      isStarter: true
    }));

    // Identify droppable players (bench only)
    const droppable = benchScored
      .filter(p => p.value < 40) // Low value threshold
      .sort((a, b) => a.value - b.value)
      .slice(0, 5);

    // Identify trade candidates (redundant depth)
    const tradeCandidates = [];

    // Look for position groups with 4+ players
    for (const [position, count] of Object.entries(positionDepth)) {
      if (count >= 4 && !['K', 'DEF'].includes(position)) {
        const positionPlayers = [...startersScored, ...benchScored]
          .filter(p => p.position === position)
          .sort((a, b) => b.value - a.value);

        // Middle-tier players are best trade candidates (not your best, not your worst)
        const midTier = positionPlayers.slice(2, 4); // 3rd and 4th best

        midTier.forEach(player => {
          tradeCandidates.push({
            ...player,
            reason: `Excess ${position} depth (${count} total)`,
            positionRank: positionPlayers.indexOf(player) + 1
          });
        });
      }
    }

    // Injured bench players are good drop candidates
    const injuredBench = benchScored.filter(p =>
      ['IR', 'Out', 'Doubtful'].includes(p.injuryStatus)
    );

    // Players on bye with better replacements available
    const byeBench = benchScored.filter(p => p.onBye);

    return {
      droppable: droppable.map(p => ({
        ...p,
        reason: this.getDropReason(p, positionDepth)
      })),
      tradeCandidates: tradeCandidates.slice(0, 3),
      injuredBench,
      byeBench,
      positionDepth
    };
  }

  /**
   * Get human-readable drop reason
   */
  getDropReason(player, positionDepth) {
    const reasons = [];

    if (player.injuryStatus === 'IR') {
      reasons.push('On IR');
    } else if (player.injuryStatus === 'Out') {
      reasons.push('Injured (Out)');
    } else if (player.injuryStatus === 'Doubtful') {
      reasons.push('Doubtful to play');
    }

    if (positionDepth[player.position] > 4) {
      reasons.push(`Deep at ${player.position} (${positionDepth[player.position]} total)`);
    }

    if (WEAK_OFFENSES.includes(player.team)) {
      reasons.push('Weak offense');
    }

    if (player.onBye) {
      reasons.push('Currently on BYE');
    }

    if (reasons.length === 0) {
      reasons.push('Low projected value');
    }

    return reasons.join(', ');
  }

  /**
   * Format First to Go analysis
   */
  formatFirstToGo(analysis) {
    const lines = [];

    lines.push('\n🗑️  FIRST TO GO - DROP CANDIDATES\n');

    if (analysis.droppable.length === 0) {
      lines.push('✓ No obvious drop candidates - roster looks solid!\n');
    } else {
      lines.push('Players to consider dropping for waiver pickups:\n');
      analysis.droppable.forEach((player, idx) => {
        const status = player.onBye ? '(BYE)' : player.injuryStatus ? `(${player.injuryStatus})` : '';
        lines.push(`${idx + 1}. ${player.name.padEnd(25)} ${player.position.padEnd(4)} ${player.team.padEnd(4)} ${status}`);
        lines.push(`   Roster Value: ${player.value}/100`);
        lines.push(`   Reason: ${player.reason}\n`);
      });
    }

    if (analysis.tradeCandidates.length > 0) {
      lines.push('\n📈 TRADE CANDIDATES\n');
      lines.push('Players with trade value from positions with depth:\n');
      analysis.tradeCandidates.forEach((player, idx) => {
        const status = player.onBye ? '(BYE)' : player.injuryStatus ? `(${player.injuryStatus})` : '';
        lines.push(`${idx + 1}. ${player.name.padEnd(25)} ${player.position.padEnd(4)} ${player.team.padEnd(4)} ${status}`);
        lines.push(`   ${player.reason}`);
        lines.push(`   Position Rank: #${player.positionRank} on your team\n`);
      });
    }

    // Position depth summary
    lines.push('\n📊 POSITION DEPTH CHART\n');
    const sortedPositions = Object.entries(analysis.positionDepth)
      .sort((a, b) => b[1] - a[1]);

    sortedPositions.forEach(([position, count]) => {
      let assessment = '';
      if (position === 'QB' && count >= 2) assessment = '✓ Good';
      else if (position === 'QB' && count < 2) assessment = '⚠️  Thin';
      else if (['RB', 'WR', 'TE'].includes(position) && count >= 4) assessment = '✓ Deep';
      else if (['RB', 'WR', 'TE'].includes(position) && count >= 3) assessment = '✓ Good';
      else if (['RB', 'WR', 'TE'].includes(position) && count < 3) assessment = '⚠️  Thin';
      else if (['K', 'DEF'].includes(position) && count >= 2) assessment = '📦 Excess';
      else if (['K', 'DEF'].includes(position) && count === 1) assessment = '✓ Good';

      lines.push(`${position}: ${count} players ${assessment}`);
    });

    return lines.join('\n');
  }
}

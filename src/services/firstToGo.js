import { ROSTER_POSITION_VALUE } from '../data/scoringConstants.js';
import { isWeakOffense } from '../data/teamRankings.js';
import { realPlayers } from '../utils/playerName.js';

/**
 * Small credit for long-term outlook, so a near-tie on projected points is
 * broken by which player still has a role to grow into. Sleeper's search_rank
 * orders every player by fantasy relevance, 1 being the most relevant.
 */
function upsideCredit(searchRank) {
  if (searchRank == null || searchRank >= 9999999) return 0;
  if (searchRank <= 50) return 20;
  if (searchRank <= 150) return 10;
  if (searchRank <= 300) return 5;
  return 0;
}

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
    if (isWeakOffense(player.team)) {
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
  async analyzeFirstToGo(roster, currentWeek, leagueId = null) {
    // Calculate position depth
    const positionDepth = {};
    const allPlayers = realPlayers([...roster.starters, ...roster.bench]);

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

    // Rest-of-season value is the honest measure of who is expendable: a
    // threshold on a heuristic score could rate a full roster as having nobody
    // to drop, which is useless when you need a spot for a waiver claim.
    const outlook = leagueId
      ? await this.rosterService.getRestOfSeasonOutlook(leagueId).catch(() => null)
      : null;

    const restOfSeasonFor = player => {
      const entry = outlook?.players?.[player.playerId];
      return entry ? entry.restOfSeason + entry.playoff : null;
    };

    const ranked = benchScored
      .map(player => {
        const restOfSeason = restOfSeasonFor(player);
        return {
          ...player,
          restOfSeason,
          // Projected points decide it, nudged by how much future a player has
          // left. Two bench backs within a few points are not equivalent if one
          // is a well-regarded handcuff and the other is roster filler.
          holdValue: (restOfSeason ?? player.value) + upsideCredit(player.searchRank)
        };
      })
      .sort((a, b) => a.holdValue - b.holdValue);

    // Always ranked, never empty while there is anyone on the bench.
    const droppable = ranked.slice(0, 5);
    const bestDrop = ranked[0] || null;

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
      bestDrop: bestDrop && {
        ...bestDrop,
        reason: this.getDropReason(bestDrop, positionDepth, ranked)
      },
      droppable: droppable.map(p => ({
        ...p,
        reason: this.getDropReason(p, positionDepth, ranked)
      })),
      rosterFull: allPlayers.length >= (roster.starters.length + roster.bench.length),
      tradeCandidates: tradeCandidates.slice(0, 3),
      injuredBench,
      byeBench,
      positionDepth
    };
  }

  /**
   * Get human-readable drop reason
   */
  getDropReason(player, positionDepth, ranked = []) {
    const reasons = [];

    // Lead with the number that decided the ranking, and say so plainly when
    // long-term outlook rather than raw points put a player first.
    if (player.restOfSeason != null) {
      reasons.push(`${Math.round(player.restOfSeason)} pts rest-of-season`);

      if (player.searchRank != null && player.searchRank > 300) {
        reasons.push(`no long-term outlook (rank ${player.searchRank})`);
      }
    }

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

    if (isWeakOffense(player.team)) {
      reasons.push('Weak offense');
    }

    if (player.onBye) {
      reasons.push('Currently on BYE');
    }

    if (reasons.length === 0) {
      reasons.push('Lowest projected value on your bench');
    }

    return reasons.join(', ');
  }

  /**
   * Format First to Go analysis
   */
  formatFirstToGo(analysis) {
    const lines = [];

    lines.push('\n🗑️  FIRST TO GO - DROP CANDIDATES\n');

    if (analysis.bestDrop) {
      const drop = analysis.bestDrop;
      lines.push(`BEST DROP: ${drop.name} (${drop.position}) ${drop.team || ''}`);
      lines.push(`  ${drop.reason}`);
      lines.push('  Least valuable player you can cut, counting both projected points and upside.\n');
    }

    if (analysis.droppable.length === 0) {
      lines.push('Your bench is empty - nothing to drop.\n');
    } else {
      lines.push('Ranked by what you give up, least valuable first:\n');
      analysis.droppable.forEach((player, idx) => {
        const status = player.onBye ? '(BYE)' : player.injuryStatus ? `(${player.injuryStatus})` : '';
        lines.push(`${idx + 1}. ${player.name.padEnd(25)} ${player.position.padEnd(4)} ${player.team.padEnd(4)} ${status}`);
        lines.push(
          player.restOfSeason != null
            ? `   Rest-of-season: ${Math.round(player.restOfSeason)} pts`
            : `   Roster Value: ${player.value}/100`
        );
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

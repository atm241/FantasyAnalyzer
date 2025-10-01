import chalk from 'chalk';

/**
 * CLI display formatting utilities
 */
export class DisplayFormatter {

  /**
   * Display roster in formatted table
   */
  displayRoster(formatted, title = 'Your Roster') {
    console.log('\n' + chalk.bold.cyan('='.repeat(70)));
    console.log(chalk.bold.cyan(title.toUpperCase()));
    console.log(chalk.bold.cyan('='.repeat(70)));

    // Starters
    console.log('\n' + chalk.bold.green('STARTERS:'));
    formatted.starters.forEach((player, idx) => {
      const status = this.getStatusIndicator(player);
      console.log(`${idx + 1}. ${chalk.bold(player.name.padEnd(25))} ${player.position.padEnd(4)} ${player.team.padEnd(4)} ${status}`);
    });

    // Bench
    console.log('\n' + chalk.bold.yellow('BENCH:'));
    formatted.bench.forEach((player, idx) => {
      const status = this.getStatusIndicator(player);
      console.log(`${idx + 1}. ${player.name.padEnd(25)} ${player.position.padEnd(4)} ${player.team.padEnd(4)} ${status}`);
    });

    console.log(chalk.bold.cyan('='.repeat(70)) + '\n');
  }

  /**
   * Display lineup optimization results
   */
  displayLineupAnalysis(analysis) {
    console.log('\n' + chalk.bold.magenta('='.repeat(70)));
    console.log(chalk.bold.magenta('LINEUP OPTIMIZATION'));
    console.log(chalk.bold.magenta('='.repeat(70)));

    console.log(`\nCurrent Projected Points: ${chalk.yellow(analysis.currentPoints.toFixed(1))}`);
    console.log(`Optimal Projected Points: ${chalk.green(analysis.optimalPoints.toFixed(1))}`);

    if (analysis.pointsGain > 0.5) {
      console.log(chalk.bold.red(`\nPotential Gain: +${analysis.pointsGain.toFixed(1)} points`));
      console.log('\n' + chalk.bold.red('RECOMMENDED CHANGES:'));

      analysis.recommendations.forEach((rec, idx) => {
        console.log(`\n${idx + 1}. ${chalk.red('Bench:')} ${rec.out.name} (${rec.out.position})`);
        console.log(`   ${chalk.green('Start:')} ${rec.in.name} (${rec.in.position})`);
        console.log(`   ${chalk.yellow('Improvement:')} +${rec.improvement.toFixed(1)} points`);
      });
    } else {
      console.log(chalk.bold.green('\n✓ Your lineup is already optimal!'));
    }

    console.log('\n' + chalk.bold.magenta('='.repeat(70)) + '\n');
  }

  /**
   * Display waiver wire recommendations
   */
  displayWaiverRecommendations(recommendations, limit = 5) {
    console.log('\n' + chalk.bold.blue('='.repeat(70)));
    console.log(chalk.bold.blue('TOP WAIVER WIRE TARGETS'));
    console.log(chalk.bold.blue('='.repeat(70)));

    for (const [position, players] of Object.entries(recommendations)) {
      if (players.length === 0) continue;

      console.log(`\n${chalk.bold.yellow(position)}:`);
      players.slice(0, limit).forEach((player, idx) => {
        if (player && player.name) {
          const trending = player.trending ? chalk.red('🔥 TRENDING') : '';
          const score = chalk.cyan(`[Score: ${player.waiverScore}]`);
          const status = this.getStatusIndicator(player);
          console.log(`${idx + 1}. ${player.name.padEnd(25)} ${(player.team || 'FA').padEnd(4)} ${status.padEnd(10)} ${score} ${trending}`);
        }
      });
    }

    console.log('\n' + chalk.bold.blue('='.repeat(70)) + '\n');
  }

  /**
   * Display roster needs analysis
   */
  displayRosterNeeds(analysis) {
    console.log('\n' + chalk.bold.yellow('='.repeat(70)));
    console.log(chalk.bold.yellow('ROSTER NEEDS ANALYSIS'));
    console.log(chalk.bold.yellow('='.repeat(70)));

    console.log('\n' + chalk.bold('Position Depth:'));
    for (const [position, count] of Object.entries(analysis.positionCounts)) {
      console.log(`${position}: ${count} players`);
    }

    if (analysis.weakPositions.length > 0) {
      console.log('\n' + chalk.bold.red('Weak Positions:'));
      analysis.weakPositions.forEach(weak => {
        console.log(`${weak.position}: ${weak.current}/${weak.recommended} (need ${weak.deficit} more)`);
      });

      console.log('\n' + chalk.bold.green('Targeted Pickups:'));
      for (const [position, players] of Object.entries(analysis.targetedPickups)) {
        console.log(`\n${chalk.bold.yellow(position)}:`);
        if (players.length === 0) {
          console.log('  No available players found');
        } else {
          players.slice(0, 3).forEach((player, idx) => {
            if (player && player.name) {
              const status = this.getStatusIndicator(player);
              const score = chalk.cyan(`[${player.waiverScore}]`);
              console.log(`${idx + 1}. ${player.name.padEnd(25)} ${(player.team || 'FA').padEnd(4)} ${status} ${score}`);
            }
          });
        }
      }
    } else {
      console.log('\n' + chalk.bold.green('✓ No major roster weaknesses detected!'));
    }

    console.log('\n' + chalk.bold.yellow('='.repeat(70)) + '\n');
  }

  /**
   * Display trending players
   */
  displayTrending(players) {
    console.log('\n' + chalk.bold.red('='.repeat(70)));
    console.log(chalk.bold.red('🔥 TRENDING AVAILABLE PLAYERS'));
    console.log(chalk.bold.red('='.repeat(70)) + '\n');

    players.forEach((player, idx) => {
      if (player && player.name) {
        const status = this.getStatusIndicator(player);
        console.log(`${idx + 1}. ${player.name.padEnd(25)} ${(player.position || 'N/A').padEnd(4)} ${(player.team || 'FA').padEnd(4)} ${status.padEnd(10)} ${chalk.yellow(`+${player.trendCount} adds`)}`);
      }
    });

    console.log('\n' + chalk.bold.red('='.repeat(70)) + '\n');
  }

  /**
   * Get status indicator for player
   */
  getStatusIndicator(player) {
    if (player.onBye) return chalk.blue('BYE');
    if (player.injuryStatus === 'Out') return chalk.red('OUT');
    if (player.injuryStatus === 'Questionable') return chalk.yellow('Q');
    if (player.injuryStatus === 'Doubtful') return chalk.red('D');
    if (player.injuryStatus === 'IR') return chalk.red('IR');
    return chalk.green('✓');
  }

  /**
   * Display error message
   */
  displayError(message) {
    console.error(chalk.bold.red('\n❌ ERROR: ') + message + '\n');
  }

  /**
   * Display success message
   */
  displaySuccess(message) {
    console.log(chalk.bold.green('\n✓ ') + message + '\n');
  }

  /**
   * Display info message
   */
  displayInfo(message) {
    console.log(chalk.bold.blue('\nℹ ') + message + '\n');
  }
}

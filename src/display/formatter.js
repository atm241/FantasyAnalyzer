import chalk from 'chalk';

/** 1 -> 1st, 2 -> 2nd, and so on. */
function ordinal(n) {
  const suffix = ['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || 'th';
  return `${n}${suffix}`;
}

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
      const name = player.emptySlot
        ? chalk.red(player.name.padEnd(25))
        : chalk.bold(player.name.padEnd(25));
      console.log(`${idx + 1}. ${name} ${player.position.padEnd(4)} ${player.team.padEnd(4)} ${status}`);
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
   * Display the players you are tracking and whether any are worth claiming.
   */
  displayWatchlist(entries) {
    if (!entries?.length) return;

    console.log('\n' + chalk.bold.magenta('WATCHING'));

    // Anything that would actually improve the lineup leads.
    const ranked = [...entries].sort((a, b) => (b.gain ?? -1) - (a.gain ?? -1));

    for (const entry of ranked) {
      if (entry.missing) {
        console.log(`  ${chalk.gray(entry.name || entry.playerId)} - no longer in the player index`);
        continue;
      }

      const tag = entry.mine
        ? chalk.green('on your roster')
        : entry.owner
          ? chalk.yellow(`rostered by ${entry.owner}`)
          : chalk.bold.green('FREE AGENT');

      const movement = entry.change == null || entry.change === 0
        ? ''
        : entry.change > 0
          ? chalk.green(`  up ${entry.change}`)
          : chalk.red(`  down ${Math.abs(entry.change)}`);

      // With no projections there is no value to report, so say nothing rather
      // than print a figure with nothing behind it.
      const priced = entry.bid?.amount != null;
      const worth = entry.gain == null
        ? chalk.gray('  value needs projections')
        : entry.gain > 2
          ? chalk.bold.green(`  +${entry.gain} pts to your lineup`)
          : chalk.gray(`  +${entry.gain} pts - would not start`);

      const bid = priced && entry.gain > 2
        ? chalk.bold(`  bid $${entry.bid.amount}`)
        : '';

      console.log(
        `  ${entry.name.padEnd(22)} ${(entry.position || '--').padEnd(4)} ` +
        `${(entry.team || 'FA').padEnd(4)} ${tag}${worth}${bid}${movement}`
      );
    }

    const claimable = ranked.filter(e => e.available && e.gain > 2);
    if (claimable.length) {
      console.log(
        '\n  ' + chalk.bold.green(`${claimable.length} worth claiming now: `) +
        claimable.map(e => `${e.name} ($${e.bid?.amount ?? '?'})`).join(', ')
      );
    }
  }

  /**
   * Warn about weeks ahead where byes gut the lineup, while there is still
   * time to do something about it.
   */
  displayByeOutlook(byeOutlook) {
    if (!byeOutlook?.trouble?.length) return;

    console.log('\n' + chalk.bold.yellow('BYE WEEKS TO PLAN FOR'));

    byeOutlook.trouble.forEach(week => {
      const lost = Math.round(week.shortfall * 100);
      console.log(
        `\n  ${chalk.bold('Week ' + week.week)}  ` +
        chalk.red(`-${lost}% of a normal lineup`) +
        chalk.gray(`  (${Math.round(week.value)} vs ${Math.round(week.baseline)} typical)`)
      );

      // Group by position so a missing quarterback is obvious at a glance.
      const byPosition = {};
      for (const player of week.onBye) {
        (byPosition[player.position] ||= []).push(player.name);
      }
      const summary = Object.entries(byPosition)
        .map(([position, names]) => `${position}: ${names.join(', ')}`)
        .join('  |  ');
      console.log(chalk.gray(`  Out - ${summary}`));

      // Losing every player at a position you must start is the real problem.
      const wipedOut = Object.keys(byPosition).filter(position =>
        ['QB', 'TE', 'DEF', 'K'].includes(position)
      );
      if (wipedOut.length) {
        console.log(
          chalk.red(`  You may have no ${wipedOut.join('/')} to start that week.`)
        );
      }
    });

    console.log(chalk.gray('\n  Plan waiver claims around these before the week arrives.'));
  }

  /**
   * Say plainly when a platform cannot supply projections.
   *
   * Everything this tool recommends is priced off projected points. Without
   * them the fallback gives every player at a position an identical score, so
   * the honest move is to name the limitation rather than fill the gap.
   */
  displayNoProjections(platform, supported = false) {
    console.log('\n' + chalk.bgYellow.black(' PROJECTIONS UNAVAILABLE '));
    console.log(chalk.yellow(supported
      ? `  The ${platform.toUpperCase()} projections feed could not be read this run.`
      : `  ${platform.toUpperCase()} does not publish player projections.`));
    console.log(chalk.gray('  Real: your roster, records, matchup scores and who is available.'));
    console.log(chalk.gray('  Not shown: lineup advice, FAAB bids, trade value, rest-of-season.'));
    console.log(chalk.gray('  Nothing below is estimated and presented as measured.'));
  }

  /**
   * Display the team's competitive window and what it implies.
   */
  displayContention(contention) {
    if (!contention) return;

    const tint = contention.stage === 'contending'
      ? chalk.green
      : contention.stage === 'rebuilding'
        ? chalk.red
        : chalk.yellow;

    console.log('\n' + tint.bold(contention.headline));
    console.log(chalk.gray(`  ${contention.reasons.join('  |  ')}`));
    console.log(`  ${contention.tradeAdvice}`);
    console.log(chalk.gray(`  Waivers: ${contention.stashPolicy}`));

    if (!contention.tradesAllowed) {
      console.log(chalk.red('  Trade deadline has passed.'));
    } else if (contention.weeksToDeadline != null && contention.weeksToDeadline <= 2) {
      console.log(chalk.yellow(`  Only ${contention.weeksToDeadline} week(s) left to trade.`));
    }
  }

  /**
   * Display a single-player report: what they are worth to you, what to bid,
   * and who to cut for them.
   */
  displayPlayerReport(report) {
    const t = report.target;
    console.log('\n' + chalk.bold.cyan('='.repeat(70)));
    console.log(chalk.bold.cyan(`${t.name.toUpperCase()}  ${t.position} ${t.team}`));
    console.log(chalk.bold.cyan('='.repeat(70)));

    const tags = [];
    if (t.searchRank != null) tags.push(`rank ${t.searchRank}`);
    if (t.depthChartOrder != null) tags.push(`${ordinal(t.depthChartOrder)} on depth chart`);
    if (t.injuryStatus) {
      tags.push(chalk.red(t.injuryStatus + (t.injuryBodyPart ? ` (${t.injuryBodyPart})` : '')));
    }
    if (tags.length) console.log('\n' + chalk.gray(tags.join('  |  ')));

    console.log(
      `\nWeek ${report.week}: ${t.projected ? chalk.bold((t.realProjection ?? 0).toFixed(1)) + ' pts' : chalk.gray('no projection - not expected to play')}`
    );
    console.log(
      `Rest of season: ${chalk.bold(Math.round(t.restOfSeason))} pts` +
      `   Playoffs (wk ${report.playoffStart}+): ${chalk.bold(Math.round(t.playoffPoints))} pts`
    );

    // Ownership
    if (report.onYourRoster) {
      console.log('\n' + chalk.green('Already on your roster.'));
    } else if (report.owner) {
      console.log('\n' + chalk.yellow(`Rostered by ${report.owner}`) + chalk.gray(' - would need a trade, not a claim.'));
    } else {
      console.log('\n' + chalk.bold.green('FREE AGENT - available to claim'));
    }

    const impact = report.lineupImpact;
    if (impact) {
      console.log('\n' + chalk.bold('Impact on your roster:'));
      const group = impact.positions?.length > 1 ? impact.positions.join('/') : t.position;
      console.log(
        `  Would rank ${chalk.bold('#' + impact.rank)} of ${impact.of} among your ${group}` +
        `  (you start ${impact.startingSlots})`
      );
      console.log(
        impact.wouldStart
          ? `  ${chalk.green('Immediate starter')}` +
            (impact.displaced ? chalk.gray(` - displaces ${impact.displaced.name}`) : '')
          : `  ${chalk.yellow('Bench depth')} - would not crack your lineup today`
      );
      if (impact.displaced) {
        const gain = Math.round(impact.gain);
        console.log(
          impact.wouldStart
            ? `  Net change: ${chalk.green('+' + gain)} pts rest-of-season`
            : chalk.gray(`  ${Math.abs(gain)} pts behind ${impact.displaced.name}, your weakest starter`)
        );
      }
    }

    // Bid
    if (report.bid?.budget) {
      const { budget, suggestion } = report.bid;
      console.log('\n' + chalk.bold('FAAB:'));
      console.log(chalk.gray(`  $${budget.remaining} of $${budget.total} left`));
      if (suggestion) {
        console.log(`  Suggested bid: ${chalk.bold.green('$' + suggestion.amount)}  ${chalk.gray(suggestion.note)}`);
      }
    } else if (report.available) {
      console.log('\n' + chalk.gray('This league does not use FAAB bidding.'));
    }

    // Drop
    if (report.drop) {
      console.log('\n' + chalk.bold('Roster space:'));
      console.log(chalk.gray(`  Holding ${report.drop.held} of ${report.drop.capacity}`));
      if (report.drop.rosterFull && report.drop.bestDrop) {
        console.log(
          `  ${chalk.red('Full')} - drop ${chalk.bold(report.drop.bestDrop.name)}` +
          ` (${report.drop.bestDrop.position})` +
          (report.drop.bestDrop.restOfSeason != null
            ? chalk.gray(`, ${Math.round(report.drop.bestDrop.restOfSeason)} pts rest-of-season`)
            : '')
        );
      } else if (!report.drop.rosterFull) {
        console.log(`  ${chalk.green('Open spot available')} - no drop needed`);
      }
    }

    console.log('\n' + chalk.bold.cyan('='.repeat(70)) + '\n');
  }

  /**
   * The live Sunday scoreboard: both lineups side by side, slot by slot.
   */
  displayLiveMatchup(live) {
    if (!live) return;

    const { you, opponent } = live;
    const width = 30;

    console.log('\n' + chalk.bold.cyan('='.repeat(70)));
    console.log(chalk.bold.cyan(`WEEK ${live.week} - LIVE`));
    console.log(chalk.bold.cyan('='.repeat(70)));

    const leading = live.margin >= 0;
    console.log(
      '\n' + (leading ? chalk.bold.green : chalk.bold)(you.teamName.slice(0, width - 8).padEnd(width - 8)) +
      (leading ? chalk.bold.green : chalk.bold)(you.total.toFixed(1).padStart(7)) +
      '   ' +
      (leading ? chalk.bold : chalk.bold.red)(opponent.total.toFixed(1).padEnd(7)) +
      (leading ? chalk.bold : chalk.bold.red)(opponent.teamName.slice(0, width - 8))
    );

    const margin = Math.abs(live.margin).toFixed(1);
    console.log(
      chalk.gray('  ') +
      (leading ? chalk.green(`leading by ${margin}`) : chalk.red(`trailing by ${margin}`))
    );

    // A deficit only means something next to what is left to play.
    const left = side => {
      const parts = [];
      if (side.playing) parts.push(`${side.playing} playing`);
      parts.push(`${side.yetToPlay} yet to play`);
      if (side.remainingProjected > 0) {
        parts.push(`~${side.remainingProjected.toFixed(0)} pts to come`);
      }
      return parts.join(', ');
    };
    console.log(chalk.gray(`  You: ${left(you)}`));
    console.log(chalk.gray(`  Them: ${left(opponent)}`));

    // The projected finish, which is what the margin will actually become.
    const yourFinish = you.total + you.remainingProjected;
    const theirFinish = opponent.total + opponent.remainingProjected;
    const projectedMargin = yourFinish - theirFinish;
    console.log(
      '  ' + chalk.bold('Projected finish: ') +
      `${yourFinish.toFixed(1)} - ${theirFinish.toFixed(1)}  ` +
      (projectedMargin >= 0
        ? chalk.green(`(+${projectedMargin.toFixed(1)})`)
        : chalk.red(`(${projectedMargin.toFixed(1)})`))
    );

    console.log('\n' + chalk.gray('  SLOT   ' + 'YOU'.padEnd(width) + 'THEM'));
    console.log(chalk.gray('  ' + '-'.repeat(66)));

    you.starters.forEach((mine, index) => {
      const theirs = opponent.starters[index];
      console.log(
        '  ' + chalk.bold(mine.slot.padEnd(6)) + ' ' +
        this.livePlayer(mine, theirs, width) + ' ' +
        this.livePlayer(theirs, mine, width)
      );
    });

    console.log('\n' + chalk.bold.cyan('='.repeat(70)) + '\n');
  }

  /** One side of a live slot: name, team and points, tinted by who is winning it. */
  livePlayer(player, rival, width) {
    if (!player) return ''.padEnd(width);

    const label = player.empty
      ? chalk.red('(empty)')
      : `${player.name.slice(0, 18)} ${chalk.gray(player.team)}`;

    const points = (player.points ?? 0).toFixed(1);
    const winning = (player.points ?? 0) > (rival?.points ?? 0);

    // Dim a score that is final, highlight one still moving, and mark a player
    // who has not started so a zero is not mistaken for a bad game.
    let tinted;
    if (player.state === 'upcoming') {
      tinted = chalk.yellow('  --  ');
    } else if (player.state === 'bye') {
      tinted = chalk.blue('  BYE ');
    } else if (player.state === 'playing') {
      tinted = chalk.bold[winning ? 'green' : 'white'](points.padStart(6));
    } else {
      tinted = winning ? chalk.green(points.padStart(6)) : chalk.gray(points.padStart(6));
    }

    // Pad on the visible text, since colour codes do not occupy columns.
    const visible = player.empty ? '(empty)' : `${player.name.slice(0, 18)} ${player.team}`;
    const pad = Math.max(width - visible.length - 7, 0);
    return label + ' '.repeat(pad) + tinted;
  }

  /**
   * Display this week's head-to-head matchup
   */
  displayMatchup(matchup) {
    if (!matchup) return;

    const { you, opponent, week } = matchup;
    console.log('\n' + chalk.bold.cyan('='.repeat(70)));
    console.log(chalk.bold.cyan(`WEEK ${week} MATCHUP`));
    console.log(chalk.bold.cyan('='.repeat(70)));

    const chance = Math.round(matchup.winProbability * 100);
    const tint = chance >= 60 ? chalk.green : chance >= 40 ? chalk.yellow : chalk.red;

    console.log(
      `\n${chalk.bold(you.teamName)} (${you.record})  ` +
      `${chalk.bold.green(you.projected.toFixed(1))}` +
      `  vs  ${chalk.bold.red(opponent.projected.toFixed(1))}  ` +
      `${chalk.bold(opponent.teamName)} (${opponent.record})`
    );

    const margin = matchup.margin;
    console.log(
      `\nProjected margin: ${margin >= 0 ? chalk.green('+' + margin.toFixed(1)) : chalk.red(margin.toFixed(1))}` +
      `   Win probability: ${tint.bold(chance + '%')}`
    );

    if (you.actual || opponent.actual) {
      console.log(chalk.gray(`Points so far: ${you.actual.toFixed(1)} - ${opponent.actual.toFixed(1)}`));
    }

    console.log('\n' + chalk.gray('  Your best       ') + chalk.gray('Their best'));
    for (let i = 0; i < 3; i++) {
      const a = you.topPlayers[i];
      const b = opponent.topPlayers[i];
      const left = a ? `${a.name} ${a.projection.toFixed(1)}` : '';
      const right = b ? `${b.name} ${b.projection.toFixed(1)}` : '';
      console.log(`  ${left.padEnd(28)}${right}`);
    }

    console.log('\n' + chalk.bold.cyan('='.repeat(70)) + '\n');
  }

  /**
   * Display lineup optimization results
   */
  displayLineupAnalysis(analysis) {
    console.log('\n' + chalk.bold.magenta('='.repeat(70)));
    console.log(chalk.bold.magenta('LINEUP OPTIMIZATION'));
    console.log(chalk.bold.magenta('='.repeat(70)));

    // Without real projections every player at a position scores the same, so
    // there is no lineup to optimise and saying otherwise would be misleading.
    if (analysis.projectionsAvailable === false) {
      console.log('\n' + chalk.yellow('Lineup optimisation needs player projections.'));
      console.log(chalk.gray('  This platform does not publish them, so no recommendation is made.'));
      console.log(chalk.gray('  Your roster and matchup above are real; anything projected is not.'));
      console.log('\n' + chalk.bold.magenta('='.repeat(70)) + '\n');
      return;
    }

    const gain = analysis.pointsGain;
    console.log(
      `\nProjected: ${chalk.yellow(analysis.currentPoints.toFixed(1))}` +
      ` -> ${chalk.green(analysis.optimalPoints.toFixed(1))}` +
      (gain > 0.5 ? chalk.bold.red(`   (+${gain.toFixed(1)})`) : '')
    );

    if (gain <= 0.5) {
      console.log(chalk.bold.green('\n\u2713 Your lineup is already optimal!'));
      console.log('\n' + chalk.bold.magenta('='.repeat(70)) + '\n');
      return;
    }

    const plan = analysis.lineupPlan;

    // What to actually do, which is what the slot-by-slot diff kept obscuring.
    if (plan?.joining.length || plan?.leaving.length) {
      console.log('\n' + chalk.bold.green('START:'));
      plan.joining.forEach(p => {
        const slot = p.slotPosition && p.slotPosition !== p.position ? ` at ${p.slotPosition}` : '';
        console.log(
          `  ${chalk.green('+')} ${p.name.padEnd(24)} ${(p.position || '').padEnd(4)}` +
          ` ${chalk.green((p.projection ?? 0).toFixed(1).padStart(5))} pts${slot}`
        );
      });

      if (plan.leaving.length) {
        console.log('\n' + chalk.bold.red('SIT:'));
        plan.leaving.forEach(p => {
          console.log(
            `  ${chalk.red('-')} ${p.name.padEnd(24)} ${(p.position || '').padEnd(4)}` +
            ` ${chalk.red((p.projection ?? 0).toFixed(1).padStart(5))} pts`
          );
        });
      }
    }

    // Full slot-by-slot view, so the whole lineup is visible at a glance.
    console.log('\n' + chalk.bold('RESULTING LINEUP:'));
    console.log(chalk.gray('  SLOT   CURRENT                   OPTIMAL'));
    plan?.slots.forEach(({ slot, current, optimal, changed }) => {
      const from = (current.name || '-').slice(0, 24).padEnd(25);
      const to = (optimal.name || '(empty)').slice(0, 24);
      const marker = changed ? chalk.yellow('>') : ' ';
      const line = `  ${marker} ${slot.padEnd(5)} ${from} ${to}`;
      console.log(changed ? line : chalk.gray(line));
    });

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
          const trending = player.trending ? chalk.red('🔥') : '  ';

          // A player with nothing this week but real value later is not a dud.
          // An injury designation still wins: it is the more urgent fact.
          const notYet = player.projected === false &&
            player.bid?.gain > 2 &&
            !player.injuryStatus &&
            !player.onBye;
          const status = notYet ? chalk.gray('LATER') : this.getStatusIndicator(player);

          // What to bid, which is the decision this board exists to support.
          const worthIt = player.bid?.gain > 2;
          const bid = player.bid?.amount == null
            ? chalk.gray('  n/a')
            : (worthIt
                ? chalk.bold.green(`$${player.bid.amount}`.padStart(5))
                : chalk.gray(`$${player.bid.amount}`.padStart(5)));
          const worth = worthIt ? chalk.gray(` +${player.bid.gain} pts`) : '';

          console.log(
            `${idx + 1}. ${player.name.padEnd(24)} ${(player.team || 'FA').padEnd(4)} ` +
            `${status.padEnd(10)} ${bid}${worth} ${trending}`
          );
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
      console.log('\n' + chalk.bold.red('Where an upgrade actually helps:'));
      analysis.weakPositions.forEach(weak => {
        console.log(
          `${chalk.bold(weak.position)}  ${chalk.gray(`have ${weak.current}, start ~${weak.recommended}`)}` +
          `  ${chalk.yellow(weak.reason || '')}`
        );
      });

      const streamable = Object.values(analysis.economics || {})
        .filter(e => e.position && e.streamable && e.idealCount > 0)
        .map(e => `${e.position} (best free agent ${e.replacement.toFixed(1)} pts)`);

      if (streamable.length > 0) {
        console.log(
          '\n' + chalk.gray(`Streamable, not worth stockpiling: ${streamable.join(', ')}`)
        );
      }

      if (analysis.budget) {
        console.log(
          '\n' + chalk.bold(`FAAB: $${analysis.budget.remaining} of $${analysis.budget.total} left`) +
          chalk.gray(` ($${analysis.budget.spent} spent)`)
        );
      }

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
              const bid = player.bid?.amount != null
                ? '  ' + chalk.bold.green(`bid $${player.bid.amount}`) + chalk.gray(` (${player.bid.note})`)
                : player.bid
                  ? chalk.gray(`  (${player.bid.note})`)
                  : '';
              console.log(
                `${idx + 1}. ${player.name.padEnd(25)} ${(player.team || 'FA').padEnd(4)} ${status} ${score}${bid}`
              );
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
    if (player.emptySlot) return chalk.bgRed.white(' EMPTY ');
    if (player.onBye) return chalk.blue('BYE');
    if (player.injuryStatus === 'Out') return chalk.red('OUT');
    if (player.injuryStatus === 'Questionable') return chalk.yellow('Q');
    if (player.injuryStatus === 'Doubtful') return chalk.red('D');
    if (player.injuryStatus === 'IR') return chalk.red('IR');
    // Sleeper omits players it does not expect to play at all this week.
    if (player.projected === false) return chalk.gray('NO PROJ');
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

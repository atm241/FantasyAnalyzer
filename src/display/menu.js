import chalk from 'chalk';

/**
 * The interactive menu.
 *
 * The full report printed five hundred lines across thirty-odd sections every
 * run. This puts the headline for each screen on one page and loads a screen's
 * detail only when you open it.
 */

/**
 * One screen: how to summarise it on the menu, and how to render it in full.
 *
 * `summary` is deliberately cheap - the menu is useless if drawing it costs as
 * much as the report it replaced.
 */
function screens(display) {
  return [
    {
      key: 'matchup',
      label: 'Matchup',
      needs: ['matchup'],
      summary: ([matchup]) => {
        if (!matchup) return chalk.gray('no matchup this week');
        const { you, opponent, state } = matchup;
        const yours = state === 'upcoming' ? matchup.projectedFinish.you : you.total;
        const theirs = state === 'upcoming' ? matchup.projectedFinish.opponent : opponent.total;
        const chance = Math.round(matchup.winProbability * 100);
        const tint = chance >= 60 ? chalk.green : chance >= 40 ? chalk.yellow : chalk.red;
        return `${yours.toFixed(1)} - ${theirs.toFixed(1)}  ` +
          tint(`${chance}%`) + chalk.gray(` ${state}`);
      },
      render: ([matchup]) => display.displayMatchup(matchup)
    },
    {
      key: 'lineup',
      label: 'Lineup',
      needs: ['lineup'],
      summary: ([lineup]) => {
        if (lineup?.projectionsAvailable === false) return chalk.gray('needs projections');
        const gain = lineup?.pointsGain ?? 0;
        return gain > 0.5
          ? chalk.yellow(`${lineup.lineupPlan?.joining.length || 0} change(s), +${gain.toFixed(1)} pts`)
          : chalk.green('optimal');
      },
      render: ([lineup]) => display.displayLineupAnalysis(lineup)
    },
    {
      key: 'waivers',
      label: 'Waivers & FAAB',
      needs: ['needs'],
      detail: ['needs', 'board'],
      summary: ([needs]) => {
        const count = needs?.weakPositions?.length || 0;
        const budget = needs?.budget
          ? chalk.gray(`  $${needs.budget.remaining} left`)
          : '';
        return (count
          ? chalk.yellow(`${count} position(s) worth upgrading`)
          : chalk.green('no upgrades needed')) + budget;
      },
      render: ([needs, board]) => {
        display.displayRosterNeeds(needs);
        display.displayWaiverRecommendations(board);
      }
    },
    {
      key: 'trades',
      label: 'Trades',
      needs: ['trades'],
      detail: ['trades', 'tradeNeeds'],
      summary: ([trades]) => {
        if (!trades?.length) return chalk.gray('nothing worth proposing');
        const best = trades[0];
        return chalk.yellow(`${trades.length} partner(s), best +${best.bestGain} pts`);
      },
      render: ([trades, needs], { tradeAnalyzer }) => {
        console.log('\n' + '='.repeat(70));
        console.log(tradeAnalyzer.formatTradeAnalysis(trades, needs));
        console.log('='.repeat(70) + '\n');
      }
    },
    {
      key: 'drops',
      label: 'Drops',
      needs: ['drops'],
      summary: ([drops]) => drops?.bestDrop
        ? chalk.gray(`${drops.bestDrop.name} (${drops.bestDrop.position})`)
        : chalk.gray('bench is empty'),
      render: ([drops], { firstToGo }) => console.log(firstToGo.formatFirstToGo(drops))
    },
    {
      key: 'byes',
      label: 'Bye weeks',
      needs: ['byes'],
      summary: ([byes]) => {
        const trouble = byes?.trouble || [];
        if (trouble.length === 0) return chalk.green('nothing to plan around');
        const worst = trouble.reduce((a, b) => (a.shortfall > b.shortfall ? a : b));
        return chalk.red(`week ${worst.week} is -${Math.round(worst.shortfall * 100)}%`);
      },
      render: ([byes]) => display.displayByeOutlook(byes)
    },
    {
      key: 'watchlist',
      label: 'Watchlist',
      needs: ['watchlist'],
      summary: ([watched]) => {
        if (!watched?.length) return chalk.gray('empty - add with --watch');
        const claimable = watched.filter(w => w.available && w.gain > 2).length;
        return claimable
          ? chalk.green(`${claimable} worth claiming`)
          : chalk.gray(`${watched.length} tracked`);
      },
      render: ([watched]) => display.displayWatchlist(watched)
    },
    {
      key: 'standings',
      label: 'Standings & odds',
      needs: ['standings'],
      summary: ([standings]) => {
        const probability = standings?.playoffProb?.probability;
        const record = standings?.userRecord;
        return `${record?.standing ?? '?'} of ${standings?.leagueSize ?? '?'}  ` +
          chalk.gray(`${probability ?? '?'}% playoff odds`);
      },
      render: ([standings], { standings: service }) =>
        console.log(service.formatStandings(standings))
    },
    {
      key: 'roster',
      label: 'Roster',
      needs: ['formatted'],
      summary: ([formatted]) => {
        const all = [...formatted.starters, ...formatted.bench];
        const empty = formatted.starters.filter(p => p.emptySlot).length;
        return empty
          ? chalk.red(`${empty} empty starting slot(s)`)
          : chalk.gray(`${all.length} players`);
      },
      render: ([formatted]) => display.displayRoster(formatted)
    },
    {
      key: 'summary',
      label: 'Strategic summary',
      needs: [],
      detail: ['summary'],
      summary: () => chalk.gray('weekly read and priorities'),
      render: ([summary], { aiSummary }) => {
        console.log('\n' + '='.repeat(70));
        console.log(aiSummary.formatSummary(summary));
        console.log('='.repeat(70) + '\n');
      }
    }
  ];
}

/**
 * Run the menu until the user quits.
 *
 * @returns {Promise<string>} 'quit' or 'switch-league'
 */
export async function runMenu({ context, display, services, prompt, header }) {
  const pages = screens(display);

  while (true) {
    await drawMenu({ context, pages, header });

    const answer = (await prompt('\nSelect: ')).trim().toLowerCase();

    if (answer === 'q' || answer === '') return 'quit';
    if (answer === 'l') return 'switch-league';
    if (answer === 'r') {
      // A fresh context drops every cached figure, so numbers are re-read.
      context.pending.clear();
      continue;
    }

    const index = Number(answer) - 1;
    const page = Number.isInteger(index) ? pages[index] : pages.find(p => p.key === answer);

    if (!page) {
      console.log(chalk.yellow(`\n'${answer}' is not one of the options.`));
      continue;
    }

    await openScreen({ page, context, services, prompt });
  }
}

/** Draw the menu with a one-line read on each screen. */
async function drawMenu({ context, pages, header }) {
  console.log('\n' + chalk.bold.cyan('='.repeat(70)));
  console.log(chalk.bold.cyan(header));
  console.log(chalk.bold.cyan('='.repeat(70)) + '\n');

  // Summaries run in parallel; each is cheap and cached after the first draw.
  const summaries = await Promise.all(pages.map(async page => {
    try {
      const inputs = await Promise.all((page.needs || []).map(key => context.get(key)));
      return page.summary(inputs);
    } catch (error) {
      return chalk.red('unavailable');
    }
  }));

  pages.forEach((page, index) => {
    console.log(
      `  ${chalk.bold(String(index + 1).padStart(2))}. ` +
      page.label.padEnd(20) + summaries[index]
    );
  });

  console.log(chalk.gray('\n   r. refresh    l. switch league    q. quit'));
}

/** Render one screen, then wait so it can be read before the menu returns. */
async function openScreen({ page, context, services, prompt }) {
  try {
    const keys = page.detail || page.needs || [];
    const inputs = await Promise.all(keys.map(key => context.get(key)));
    page.render(inputs, services);
  } catch (error) {
    console.log(chalk.red(`\nCould not load ${page.label}: ${error.message}`));
  }

  await prompt(chalk.gray('Press enter to go back: '));
}

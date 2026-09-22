/**
 * Where a team sits in its competitive window, and what that implies.
 *
 * Every other piece of advice depends on this. A 1-1 team with a strong roster
 * should spend budget and buy win-now help; a team that is already out of it
 * should bank budget and hold upside. Without this the tool gives both the same
 * answer, which is wrong for at least one of them.
 */

/** Playoff odds above which a team is playing for this season. */
const CONTENDING_ODDS = 0.6;
const FRINGE_ODDS = 0.25;

/**
 * Early on, odds are driven mostly by roster strength rather than results, so
 * a bad start is not yet evidence. Confidence grows as the season resolves.
 */
function confidenceFor(week, playoffStart) {
  const elapsed = Math.max(week - 1, 0);
  const runway = Math.max(playoffStart - 1, 1);
  return Math.min(elapsed / runway, 1);
}

/**
 * Classify a team and derive the posture the rest of the tool should take.
 *
 * @param {object} input
 * @param {number} input.playoffProbability 0-1
 * @param {object} input.record wins/losses and points
 * @param {number} input.standing league position, 1 is first
 * @param {number} input.leagueSize teams in the league
 * @param {number} input.week current NFL week
 * @param {number} input.playoffStart first week of the fantasy playoffs
 * @param {number} input.tradeDeadline last week trades are allowed
 */
export function assessContention({
  playoffProbability = 0,
  record = { wins: 0, losses: 0 },
  standing = 0,
  leagueSize = 12,
  week = 1,
  playoffStart = 15,
  tradeDeadline = null
}) {
  const confidence = confidenceFor(week, playoffStart);
  const reasons = [];

  let stage;
  if (playoffProbability >= CONTENDING_ODDS) {
    stage = 'contending';
    reasons.push(`${Math.round(playoffProbability * 100)}% playoff odds`);
  } else if (playoffProbability >= FRINGE_ODDS) {
    stage = 'fringe';
    reasons.push(`${Math.round(playoffProbability * 100)}% playoff odds - in the hunt but not safe`);
  } else {
    stage = 'rebuilding';
    reasons.push(`${Math.round(playoffProbability * 100)}% playoff odds`);
  }

  // Early in the year the odds are mostly a read on roster strength, so a poor
  // record is not yet a reason to give up on the season.
  if (stage === 'rebuilding' && confidence < 0.35) {
    stage = 'fringe';
    reasons.push('too early to write off the season');
  }

  if (standing > 0) {
    reasons.push(`${ordinal(standing)} of ${leagueSize}`);
  }
  reasons.push(`${record.wins}-${record.losses}`);

  const weeksToDeadline = tradeDeadline ? tradeDeadline - week : null;
  if (weeksToDeadline != null && weeksToDeadline <= 0) {
    reasons.push('trade deadline has passed');
  } else if (weeksToDeadline != null && weeksToDeadline <= 2) {
    reasons.push(`${weeksToDeadline} week(s) to the trade deadline`);
  }

  return {
    stage,
    confidence,
    playoffProbability,
    weeksToDeadline,
    tradesAllowed: weeksToDeadline == null || weeksToDeadline > 0,
    reasons,
    ...postureFor(stage)
  };
}

/** What each stage means for spending, trading and holding upside. */
function postureFor(stage) {
  switch (stage) {
    case 'contending':
      return {
        headline: 'Contending - play for this season',
        // Spend budget on players who help now; unspent FAAB scores nothing.
        faabMultiplier: 1.25,
        tradePosture: 'buy',
        tradeAdvice: 'Buy win-now help. Prefer the best player in a deal over the larger package.',
        stashPolicy: 'Cut speculative stashes for players who start for you now.',
        valueWeight: { restOfSeason: 0.55, playoff: 0.45 }
      };
    case 'rebuilding':
      return {
        headline: 'Out of the race - play for next season',
        // Budget is worth more banked than spent on a lost season.
        faabMultiplier: 0.4,
        tradePosture: 'sell',
        tradeAdvice: 'Sell veterans to contenders and take back upside. Do not rent help.',
        stashPolicy: 'Hold high-upside stashes over marginal weekly starters.',
        valueWeight: { restOfSeason: 0.8, playoff: 0.2 }
      };
    default:
      return {
        headline: 'On the bubble - stay flexible',
        faabMultiplier: 1.0,
        tradePosture: 'hold',
        tradeAdvice: 'Take clear wins, avoid mortgaging depth until the picture is clearer.',
        stashPolicy: 'Keep a stash only if it does not cost you a startable player.',
        valueWeight: { restOfSeason: 0.7, playoff: 0.3 }
      };
  }
}

function ordinal(n) {
  const suffix = ['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : Math.min(n % 10, 4) % 4] || 'th';
  return `${n}${suffix}`;
}

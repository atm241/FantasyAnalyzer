/**
 * League-specific position economics.
 *
 * Replaces the fixed position-value tables, which could not know that a league
 * runs three FLEX slots in PPR (so receivers carry far more weight) or that its
 * defenses and kickers are streamable - the best one on waivers each week is as
 * good as the one on your roster, so "roster two of them" is wasted advice.
 *
 * Everything here is derived from the league's own slots, its scoring settings
 * and this week's real projections.
 */

const FANTASY_POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];

/** Which positions each flex variant accepts. */
const FLEX_ELIGIBILITY = {
  FLEX: ['RB', 'WR', 'TE'],
  WRRB_FLEX: ['RB', 'WR'],
  REC_FLEX: ['WR', 'TE'],
  SUPER_FLEX: ['QB', 'RB', 'WR', 'TE']
};

/**
 * A position is streamable when the best player sitting on waivers is close to
 * what you would start. Expressed in projected points.
 */
const STREAMABLE_GAP = 2.0;

/** How interchangeable the top of the waiver pool is, 1st versus 5th best. */
const FUNGIBLE_DROPOFF = 2.5;

function projectionOf(player) {
  return player?.realProjection ?? 0;
}

function sortedProjections(players) {
  return players
    .filter(p => p && p.realProjection != null && !p.onBye)
    .map(projectionOf)
    .sort((a, b) => b - a);
}

/**
 * Count dedicated and flex starting slots from the league's roster positions.
 */
function countSlots(rosterPositions = []) {
  const dedicated = {};
  const flex = [];

  for (const slot of rosterPositions) {
    if (slot === 'BN' || slot === 'IR' || slot === 'TAXI') continue;

    if (FLEX_ELIGIBILITY[slot]) {
      flex.push(FLEX_ELIGIBILITY[slot]);
    } else if (FANTASY_POSITIONS.includes(slot)) {
      dedicated[slot] = (dedicated[slot] || 0) + 1;
    }
  }

  return { dedicated, flex };
}

/**
 * Split flex slots across the positions that can fill them, in proportion to
 * how often that position actually shows up among the league's best flex-worthy
 * players. In PPR this naturally lands most of the share on receivers.
 */
function shareFlexSlots(flex, projectionsByPosition, teams) {
  const share = {};

  for (const eligible of flex) {
    // The players realistically competing for this flex slot league-wide.
    const pool = [];
    for (const position of eligible) {
      for (const points of (projectionsByPosition[position] || []).slice(0, teams)) {
        pool.push({ position, points });
      }
    }

    pool.sort((a, b) => b.points - a.points);
    const contenders = pool.slice(0, Math.max(teams, 1));
    if (contenders.length === 0) continue;

    const counts = {};
    for (const { position } of contenders) {
      counts[position] = (counts[position] || 0) + 1;
    }

    for (const [position, count] of Object.entries(counts)) {
      share[position] = (share[position] || 0) + count / contenders.length;
    }
  }

  return share;
}

/**
 * Build the per-position picture for a league.
 *
 * Flex demand is pooled rather than split per position: a flex slot goes to the
 * best eligible player regardless of position, so a second tight end is only a
 * need if it would beat the receiver that would otherwise fill that slot.
 *
 * @param {object} input
 * @param {string[]} input.rosterPositions league starting slots, including BN
 * @param {object} input.availableByPosition unrostered players keyed by position
 * @param {object} input.rosteredByPosition your players keyed by position
 * @param {number} input.teams number of teams in the league
 */
export function buildPositionEconomics({
  rosterPositions = [],
  availableByPosition = {},
  rosteredByPosition = {},
  teams = 12
}) {
  const { dedicated, flex } = countSlots(rosterPositions);

  const availableProjections = {};
  for (const position of FANTASY_POSITIONS) {
    availableProjections[position] = sortedProjections(availableByPosition[position] || []);
  }

  const flexShare = shareFlexSlots(flex, availableProjections, teams);
  const flexEligible = new Set(flex.flat());
  const flexSlots = flex.length;

  // Your players who are not already needed for a dedicated slot compete for
  // the flex slots, whatever position they play.
  const flexBench = [];
  for (const position of FANTASY_POSITIONS) {
    const mine = sortedProjections(rosteredByPosition[position] || []);
    const spoken = dedicated[position] || 0;
    if (!flexEligible.has(position)) continue;
    for (const points of mine.slice(spoken)) flexBench.push(points);
  }
  flexBench.sort((a, b) => b - a);

  // The weakest player currently holding a flex slot, and the best flex-capable
  // player available on waivers at any position.
  const flexMarginal = flexSlots > 0 ? (flexBench[flexSlots - 1] ?? 0) : 0;
  const flexReplacement = Math.max(
    0,
    ...[...flexEligible].map(position => availableProjections[position]?.[0] ?? 0)
  );

  const economics = {};

  for (const position of FANTASY_POSITIONS) {
    const waiver = availableProjections[position];
    const replacement = waiver[0] ?? 0;
    const dropoff = waiver.length > 4 ? replacement - waiver[4] : replacement;

    const dedicatedSlots = dedicated[position] || 0;
    const mine = sortedProjections(rosteredByPosition[position] || []);
    const rostered = (rosteredByPosition[position] || []).length;

    // A genuine hole: not enough bodies for the slots you must fill.
    const dedicatedShortfall = Math.max(dedicatedSlots - rostered, 0);

    // What this position's best waiver option would actually replace.
    const isFlexEligible = flexEligible.has(position);
    const incumbent = dedicatedShortfall > 0
      ? (mine[dedicatedSlots - 1] ?? 0)
      : isFlexEligible
        ? flexMarginal
        : (mine[Math.max(dedicatedSlots - 1, 0)] ?? 0);

    const upgrade = replacement - incumbent;

    // Streamable: the waiver pool is flat and its best option is no worse than
    // what you would start, so there is nothing to hoard.
    const streamable =
      dedicatedSlots <= 1 &&
      !isFlexEligible &&
      (dropoff <= FUNGIBLE_DROPOFF || Math.abs(upgrade) <= STREAMABLE_GAP);

    // Roster this many: dedicated slots, plus cover only where the waiver wire
    // cannot readily replace the player.
    const flexCover = isFlexEligible ? Math.round(flexShare[position] || 0) : 0;
    const cushion = streamable || dropoff <= FUNGIBLE_DROPOFF ? 0 : 1;
    const idealCount = Math.max(dedicatedSlots + flexCover + cushion, dedicatedSlots);

    economics[position] = {
      position,
      dedicatedSlots,
      flexShare: Number((flexShare[position] || 0).toFixed(2)),
      flexEligible: isFlexEligible,
      starterSlots: Number((dedicatedSlots + (flexShare[position] || 0)).toFixed(2)),
      replacement: Number(replacement.toFixed(1)),
      dropoff: Number(dropoff.toFixed(1)),
      incumbent: Number(incumbent.toFixed(1)),
      upgrade: Number(upgrade.toFixed(1)),
      streamable,
      rostered,
      dedicatedShortfall,
      idealCount,
      // Priority for waivers and trades: only positive when a pickup would
      // actually improve the lineup you can field. A position the league does
      // not start at all is worth nothing, however good the free agents are.
      priority: idealCount === 0 ? 0 : Number(Math.max(upgrade, 0).toFixed(1))
    };
  }

  economics.__flex = { slots: flexSlots, marginal: Number(flexMarginal.toFixed(1)), replacement: Number(flexReplacement.toFixed(1)) };
  return economics;
}

/**
 * Value of a player above what the same position offers for free on waivers.
 * This is what makes a receiver in a three-flex PPR league worth more than a
 * defense that any team can replace on Wednesday.
 */
export function valueOverReplacement(player, economics) {
  const position = economics?.[player?.position];
  if (!position) return 0;
  return projectionOf(player) - position.replacement;
}

export { FANTASY_POSITIONS };

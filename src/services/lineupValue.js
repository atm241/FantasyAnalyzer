/**
 * What a set of players is actually worth as a starting lineup.
 *
 * Summed points treat every player as additive, but a roster only scores from
 * the slots it can fill. Two mid receivers do not replace one stud, and a
 * pickup who never cracks the lineup is worth nothing however well he projects.
 * Both trade evaluation and waiver bids price off this.
 */

/** Which positions each starting slot accepts. */
export function slotAccepts(slot, position) {
  if (slot === 'FLEX') return ['RB', 'WR', 'TE'].includes(position);
  if (slot === 'SUPER_FLEX') return ['QB', 'RB', 'WR', 'TE'].includes(position);
  if (slot === 'WRRB_FLEX') return ['RB', 'WR'].includes(position);
  if (slot === 'REC_FLEX') return ['WR', 'TE'].includes(position);
  return slot === position;
}

/**
 * Best lineup value a set of players can produce, filling each slot greedily
 * with the most valuable eligible player still available.
 *
 * @param {object[]} players roster entries
 * @param {string[]} rosterPositions league slots, including BN
 * @param {function} valueOf maps a player to their value (points)
 */
export function bestLineupValue(players, rosterPositions, valueOf) {
  const slots = (rosterPositions || []).filter(slot => slot !== 'BN');
  if (slots.length === 0) return 0;

  const pool = players
    .map(player => ({ player, value: valueOf(player) }))
    .sort((a, b) => b.value - a.value);

  const used = new Set();
  let total = 0;

  for (const slot of slots) {
    const pick = pool.find(
      entry => !used.has(entry.player.playerId) && slotAccepts(slot, entry.player.position)
    );
    if (!pick) continue;
    used.add(pick.player.playerId);
    total += pick.value;
  }

  return total;
}

/**
 * What adding a player does to your starting lineup, after dropping whoever
 * you would actually cut for them.
 *
 * Returns the change in lineup value. A pickup who does not crack the lineup
 * scores zero here, which is the honest answer - he adds nothing this season
 * unless someone ahead of him gets hurt.
 *
 * @param {object} input
 * @param {object[]} input.roster your current players
 * @param {object} input.addition the player being added
 * @param {object} [input.dropping] who you would cut; defaults to the least
 *   valuable player, which is what a full roster forces
 */
export function lineupGainFromAdding({ roster, addition, dropping, rosterPositions, valueOf }) {
  const before = bestLineupValue(roster, rosterPositions, valueOf);

  const cut = dropping || [...roster].sort((a, b) => valueOf(a) - valueOf(b))[0];
  const after = roster
    .filter(player => player.playerId !== cut?.playerId)
    .concat(addition);

  return bestLineupValue(after, rosterPositions, valueOf) - before;
}

/**
 * What adding a player is worth across every remaining week, summed.
 *
 * Valuing a season total hides bye weeks: a backup quarterback looks worthless
 * because your starter outscores him overall, right up to the week your starter
 * is off and you have nobody. Pricing each week separately counts a player only
 * in the weeks he would actually be in your lineup, which is the real answer.
 *
 * @param {object} input
 * @param {object[]} input.roster your current players
 * @param {object} input.addition the player being added
 * @param {object} [input.dropping] who you would cut to make room
 * @param {string[]} input.rosterPositions league slots including BN
 * @param {number[]} input.weeks remaining weeks to value
 * @param {function} input.pointsIn (player, week) -> projected points
 */
export function weeklyLineupGain({
  roster, addition, dropping, rosterPositions, weeks, pointsIn
}) {
  const cut = dropping || [...roster].sort(
    (a, b) => totalOver(a, weeks, pointsIn) - totalOver(b, weeks, pointsIn)
  )[0];

  const after = roster
    .filter(player => player.playerId !== cut?.playerId)
    .concat(addition);

  let gain = 0;
  for (const week of weeks) {
    const valueOf = player => pointsIn(player, week);
    gain += bestLineupValue(after, rosterPositions, valueOf) -
      bestLineupValue(roster, rosterPositions, valueOf);
  }

  return gain;
}

function totalOver(player, weeks, pointsIn) {
  return weeks.reduce((sum, week) => sum + pointsIn(player, week), 0);
}

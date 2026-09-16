/**
 * Display name for a player record.
 *
 * Team defenses have no `full_name` on Sleeper - they carry the city and
 * nickname separately (e.g. first_name "Seattle", last_name "Seahawks"), so
 * reading `full_name` alone renders them as "undefined".
 */
export function getPlayerName(player, fallback = 'Unknown') {
  if (!player) return fallback;

  if (player.full_name) return player.full_name;

  const parts = [player.first_name, player.last_name].filter(Boolean);
  if (parts.length > 0) return parts.join(' ');

  return player.name || player.team || fallback;
}

/**
 * Sleeper represents an unfilled starting slot with the player id "0".
 */
export function isEmptySlot(playerId) {
  return !playerId || playerId === '0' || playerId === 0;
}

/**
 * Roster entries that are real players. The lineup keeps a placeholder for an
 * unfilled starting slot, which must never be counted, traded or dropped.
 */
export function realPlayers(entries) {
  return (entries || []).filter(entry => entry && !entry.emptySlot);
}

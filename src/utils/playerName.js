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

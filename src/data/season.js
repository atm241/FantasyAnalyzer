/**
 * Season helpers
 *
 * The NFL season year and its start date are derived from the current date so
 * the analyzer does not need to be edited every August.
 */

/**
 * Date of the NFL regular season opener for a given year.
 * Week 1 kicks off on the Thursday following Labor Day (the first Monday in
 * September). Verified against 2024 (Sep 5) and 2025 (Sep 4).
 */
export function getSeasonStartDate(year) {
  const sept1 = new Date(Date.UTC(year, 8, 1));
  // Days to advance from Sept 1 to the first Monday (getUTCDay: 0=Sun, 1=Mon).
  const daysToFirstMonday = (8 - sept1.getUTCDay()) % 7;
  const laborDay = new Date(Date.UTC(year, 8, 1 + daysToFirstMonday));
  // Opener is the Thursday of that same week, three days after Labor Day.
  return new Date(laborDay.getTime() + 3 * 24 * 60 * 60 * 1000);
}

/**
 * The NFL season year currently in play.
 * January and February still belong to the previous year's season (playoffs),
 * while leagues for the upcoming season appear from March onward.
 */
export function getCurrentSeasonYear(now = new Date()) {
  const year = now.getUTCFullYear();
  return now.getUTCMonth() < 2 ? year - 1 : year;
}

# Fantasy Analyzer

A comprehensive fantasy football analysis tool supporting **Sleeper** and **ESPN** leagues.

## Features

✅ **League Standings & Playoff Probability** - Monte Carlo simulation for accurate playoff chances
✅ **Optimal Lineup Recommendations** - AI-powered lineup optimizer accounting for BYE weeks
✅ **Waiver Wire Rankings** - Scored recommendations for available players
✅ **First to Go Analysis** - Identify droppable players and trade candidates
✅ **AI Strategic Summary** - Weekly team analysis and next steps
✅ **BYE Week Detection** - Automatic detection and recommendations
✅ **Roster Depth Analysis** - Identify position weaknesses
✅ **Trending Players** - See hot waiver pickups (Sleeper only)

## Setup

```bash
npm install
```

## Sunday scoreboard

During Sunday games the tool leads with the live head-to-head instead of
analysis - both lineups side by side, slot by slot, with what each starter has
scored so far:

```
Gorlami                 114.9   143.3  Gorbanzo Beans
  trailing by 28.4

  SLOT   YOU                           THEM
  QB     Drake Maye NE             5.8 Joe Burrow CIN           22.6
  RB     Derrick Henry BAL        21.9 Jahmyr Gibbs DET         41.4
  ...
```

Each starter is marked by where their game stands - a final score, a score
still moving, `--` for a game that has not kicked off, or `BYE` - so a zero is
never mistaken for a bad afternoon. Alongside the margin it reports how many
starters each side has left and the projected finish, because trailing by thirty
with three players to play is a different position from trailing by thirty with
none.

It switches on by itself from noon Central on Sunday until the night game is
over, measured in Central time wherever you run it. `--live` forces it at any
time and `--no-live` suppresses it.

## Watching players

Track free agents you are interested in and they are re-valued against your
roster on every run:

```bash
npm start -- --watch "C.J. Stroud"
npm start -- --unwatch "C.J. Stroud"
```

```
WATCHING
  AJ Barner    TE  SEA  FREE AGENT  +21 pts to your lineup  bid $15  up 6
  C.J. Stroud  QB  HOU  FREE AGENT  +16 pts to your lineup  bid $11
  Carnell Tate WR  TEN  rostered by Gorpes

  2 worth claiming now: AJ Barner ($15), C.J. Stroud ($11)
```

Each run records what a player was worth, so the next one shows whether they are
rising or fading. Lists are kept per league in `config.json`.

## Bye weeks

Byes are projected forward across the whole season, not just checked for the
current week. Weeks where byes gut your lineup are flagged while there is still
time to claim cover, and a position with a week you could field nobody is
treated as a need however streamable it usually is.

Waiver value is calculated week by week rather than from season totals, which is
what makes this work: a backup quarterback is worth nothing in most weeks and a
full starter's points in the week yours is off.

## Playoff odds

Odds come from a Monte Carlo simulation of the remaining schedule. Each team's
weekly score is projected from the lineup they can actually field, blended with
how they have scored so far - weighted by how many games there are to learn
from, and capped so history never outweighs the projection.

Forecasting from points per game alone was the weak point: after two games the
spread across a league is mostly luck, and the simulation treated it as signal.
The run is seeded from league state, so the same inputs always give the same
number.

## Competitive window

Advice is shaped by whether your season is still live. The tool classifies your
team from playoff odds, record and how far the season has run, then adjusts:

| | Contending | On the bubble | Out of it |
|---|---|---|---|
| FAAB | bid up 25% | normal | bid down 60% |
| Trades | buy win-now | take clear wins only | sell veterans for upside |
| Drops | cut stashes for starters | keep cheap stashes | hold upside over depth |

Early in the season a losing record is not yet treated as evidence, since odds
at that point mostly reflect roster strength rather than results.

## Looking up one player

To answer "should I add this guy, and what should I bid?" without reading the
whole report:

```bash
npm start -- --player "Carnell Tate"
```

It reports the player's projection, rest-of-season and playoff value, whether
they are a free agent or need a trade, where they would rank among the players
you can actually start, a suggested FAAB bid, and who to drop to make room.
Partial names work; ambiguous ones prompt.

## Tests

```bash
npm test
```

Forty tests over the valuation core, using node's built-in runner - no
dependencies, no network, and no reliance on what any real roster looks like
this week. They pin down behaviour that has broken before: the week rolling over
during Monday night football, a defence rendering as "undefined", two mid
players appearing to outweigh one stud, a position the league never starts being
treated as a priority, and a highly ranked player buried on his depth chart
being valued as a starter.

## When projections are unavailable

Every recommendation here is priced off projected points. ESPN publishes no
projections feed, and without one the estimate fallback gives every player at a
position an identical score - so the tool says so rather than filling the gap:

```
 PROJECTIONS UNAVAILABLE
  ESPN does not publish player projections.
  Real: your roster, records, matchup scores and who is available.
  Not shown: lineup advice, FAAB bids, trade value, rest-of-season.
```

Lineup advice, FAAB bids, trade proposals and rest-of-season value are withheld
rather than guessed at. Rosters, records, live scores and free-agent lists are
unaffected. A feed that simply could not be read this run is reported
differently from a platform that has none.

## Keeping season data current

Everything season-specific is derived at runtime, so the tool rolls into a new
season on its own with no files to hand-edit:

| Data | Source |
|------|--------|
| Season year & current week | Sleeper season state / the live NFL schedule |
| BYE weeks | derived from the schedule (teams with no game that week) |
| Offensive tiers | ranked from actual points per game |

Offensive tiers use the current season once the average team has played 4 games,
and last season's finished data before that. If either feed is unreachable the
tool keeps running with a visible warning - weeks are estimated and every team is
projected as average, rather than silently using stale numbers.

Injury designations change through the week, so they are re-read on every run
from the projections feed rather than the cached player index - a player cleared
this morning shows as healthy immediately. Slower-moving data (names, positions,
depth-chart order) comes from a player index cached for a day; use `--refresh`
to refetch that too:

```bash
npm start -- --refresh
```

Run the freshness check at the start of a season, or in CI:

```bash
npm run check
```

It fails if a hardcoded season year creeps back into `src/`, if the schedule feed
doesn't yield 32 teams across 18 weeks with a bye for every team, if the derived
week disagrees with Sleeper's own season state, or if the offensive tiers are
missing, incomplete, or more than a season out of date.

## Usage

Run it with no arguments and it asks which platform your league is on, then
walks you through the rest:

```bash
npm start
```

```
Which platform is your league on?

1. Sleeper
2. ESPN

Select a platform (enter number):
```

Leagues you analyse are remembered, so later runs open straight on a picker:

```
Your saved leagues:

1. Chill League (SLEEPER - gruidlp)
2. Cupcake League (SLEEPER - gruidlp)
3. Add another league
4. Remove a saved league
```

They live in `config.json` beside the project, which is gitignored. ESPN private
leagues need cookies to read at all, so those are stored there too - treat the
file as a local credential store.

Pass `--platform`, `--league` or `--username` to skip the picker entirely
(useful in scripts). Everything else is prompted for.

### Sleeper League

```bash
npm start -- --platform sleeper --username YOUR_SLEEPER_USERNAME
```

Or with a specific league:
```bash
npm start -- --platform sleeper --username YOUR_SLEEPER_USERNAME --league LEAGUE_ID
```

### ESPN League

For public leagues:
```bash
npm start -- --platform espn --league YOUR_LEAGUE_ID
```

For private leagues (requires cookies):
```bash
npm start -- --platform espn --league YOUR_LEAGUE_ID --espn-s2 "YOUR_ESPN_S2_COOKIE" --swid "YOUR_SWID_COOKIE"
```

#### How to get ESPN cookies for private leagues:

1. Log into ESPN Fantasy on your browser
2. Open Developer Tools (F12)
3. Go to Application/Storage → Cookies → `https://fantasy.espn.com`
4. Copy the values for `espn_s2` and `SWID`
5. Use them in the command above

## Platform Comparison

| Feature | Sleeper | ESPN |
|---------|---------|------|
| Standings & Playoffs | ✅ | ✅ |
| Lineup Optimizer | ✅ | ✅ |
| Waiver Rankings | ✅ | ✅ |
| Trending Players | ✅ | ❌ |
| BYE Week Detection | ✅ | ✅ |
| Private League Support | ✅ | ✅ (requires cookies) |

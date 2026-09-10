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

## Keeping season data current

Season year, current week and BYE weeks are all derived at runtime from the live
NFL schedule, so the tool rolls into a new season on its own - there are no
hardcoded dates to update.

The one exception is `src/data/teamRankings.js`, which holds hand-maintained
subjective tiers (elite offenses, tough defenses). Run the freshness check at the
start of each season to confirm everything lines up and to be reminded when those
tiers need a review:

```bash
npm run check
```

It fails if any hardcoded season year creeps back into `src/`, if the schedule
feed looks wrong, if the derived week disagrees with Sleeper's own season state,
or if the subjective rankings predate the current season.

## Usage

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

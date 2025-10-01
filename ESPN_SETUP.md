# ESPN Fantasy Football Setup Guide

## Quick Start

### Public ESPN League
```bash
npm start -- --platform espn --league YOUR_LEAGUE_ID
```

### Private ESPN League
```bash
npm start -- --platform espn --league YOUR_LEAGUE_ID --espn-s2 "YOUR_ESPN_S2" --swid "YOUR_SWID"
```

## Finding Your League ID

### On Desktop/Web Browser:
1. Go to your ESPN Fantasy Football league
2. Look at the URL: `https://fantasy.espn.com/football/team?leagueId=123456&seasonId=2025`
3. Your League ID is the number after `leagueId=` (in this example: `123456`)

### On iOS (iPhone/iPad):
1. Open the **ESPN Fantasy** app
2. Go to your league
3. Tap the **League** tab at the bottom
4. Tap **League Info**
5. Your **League ID** is displayed there

**Alternative method for iOS:**
1. Open the ESPN Fantasy app
2. Go to your league
3. Tap **Share** or **Invite**
4. The invite link will show your League ID in the URL
5. Example: `fantasy.espn.com/football/league/join?leagueId=123456`
6. The League ID is `123456`

## Getting Cookies for Private Leagues

Private ESPN leagues require authentication cookies. Here's how to get them:

### Chrome/Edge:
1. Log into your ESPN Fantasy league
2. Press `F12` to open Developer Tools
3. Go to the **Application** tab (or **Storage** in some browsers)
4. In the left sidebar, expand **Cookies** → `https://fantasy.espn.com`
5. Find and copy the values for:
   - `espn_s2` (long string)
   - `SWID` (format: `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`)

### Firefox:
1. Log into your ESPN Fantasy league
2. Press `F12` to open Developer Tools
3. Go to the **Storage** tab
4. Expand **Cookies** → `https://fantasy.espn.com`
5. Find and copy `espn_s2` and `SWID`

### Safari:
1. Enable Develop menu: Preferences → Advanced → "Show Develop menu"
2. Log into your ESPN Fantasy league
3. Develop → Show Web Inspector
4. Go to **Storage** tab
5. Expand **Cookies** → `https://fantasy.espn.com`
6. Find and copy `espn_s2` and `SWID`

## Example Usage

```bash
# Public league (no cookies needed)
npm start -- --platform espn --league 123456

# Private league with cookies
npm start -- --platform espn --league 123456 \
  --espn-s2 "AEBxdL...very_long_string...xyz123" \
  --swid "{12345678-1234-1234-1234-123456789012}"

# Specify season year (default is 2025)
npm start -- --platform espn --league 123456 --season 2024
```

## Troubleshooting

### "League not found" or "Access denied"
- Verify your League ID is correct
- If it's a private league, ensure you're providing valid cookies
- Cookies expire after ~2 weeks, you may need to refresh them

### "No teams found"
- Check that the season year is correct (use `--season 2025`)
- Verify you have access to the league

### Getting team-specific data
When prompted for "team name or identifier", you can enter:
- Your team name (e.g., "Drake won the beef")
- Your ESPN username
- Any identifier you want to use

The tool will automatically find your team in the league.

## Features Available for ESPN

✅ League standings and playoff probability
✅ Optimal lineup recommendations
✅ BYE week detection and warnings
✅ Waiver wire rankings
✅ First to Go (drop/trade candidates)
✅ AI strategic summary
✅ Roster depth analysis

❌ Trending players (ESPN API doesn't provide this data)

## Cookie Security

**Important:** Your cookies are authentication credentials. Keep them secure:
- Don't share them publicly
- Don't commit them to Git
- They expire periodically and need to be refreshed

The app only uses cookies to authenticate API requests and doesn't store them anywhere.

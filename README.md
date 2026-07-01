# PS99 Pet Hatch Tracker

This is a starter tracker for Pet Simulator 99. It uses the BIG Games OAuth API to read your authorized inventory, compares it with the last saved snapshot, and sends a Discord bot message when a watched pet appears or increases.

Important limitation: the public API exposes inventory snapshots, not live hatch events. This tracker can detect "you now have more of this watched pet than before," but it cannot prove the pet came specifically from hatching.

## What You Need

- Node.js 20+
- A Discord bot token
- A BIG Games developer app
- Your BIG Games app redirect URL set to:

```text
http://localhost:3000/oauth/callback
```

For the BIG Games app scopes, select:

```text
Pet Simulator 99 - Inventory
Pet Simulator 99 - Profile
```

## Setup

1. Install dependencies:

```bash
npm install
```

2. Copy the env file:

```bash
copy .env.example .env
```

3. Fill in `.env`.

For faster slash-command testing, add your server ID too:

```env
DISCORD_GUILD_ID=your_discord_server_id
```

If you leave `DISCORD_GUILD_ID` blank, commands are registered globally and Discord can take a while to show them.

4. Start the tracker:

```bash
npm run dev
```

5. Open this in your browser:

```text
http://localhost:3000/auth/start
```

Approve your BIG Games app. After the callback succeeds, the tracker stores your token locally in `data/store.json` and starts checking your inventory.

## Discord Setup Notes

Create a bot in the Discord Developer Portal, copy its token into `DISCORD_BOT_TOKEN`, invite it to your server, and give it permission to send messages in the configured channel.

To get IDs, enable Discord Developer Mode, then right-click the channel/user and choose "Copy ID".

Invite URL format:

```text
https://discord.com/oauth2/authorize?client_id=YOUR_DISCORD_APPLICATION_ID&scope=bot%20applications.commands&permissions=2048
```

Use your Discord application's Application ID as `YOUR_DISCORD_APPLICATION_ID`.

## Railway 24/7 Hosting

Railway can run this as a normal Node service. The project already has a `start` script, so Railway should use:

```bash
npm start
```

For Railway, do not use the localhost BIG Games callback. After deployment, use your Railway public URL:

```text
https://your-service.up.railway.app/oauth/callback
```

Set that same URL in both places:

- `BIG_GAMES_REDIRECT_URI` in Railway variables
- Redirect URLs in your BIG Games developer app settings

Recommended Railway variables:

```env
DISCORD_BOT_TOKEN=...
DISCORD_CHANNEL_ID=...
DISCORD_USER_ID=...
DISCORD_GUILD_ID=...
BIG_GAMES_CLIENT_ID=...
BIG_GAMES_CLIENT_SECRET=...
BIG_GAMES_REDIRECT_URI=https://your-service.up.railway.app/oauth/callback
POLL_INTERVAL_MINUTES=6
WATCH_KEYWORDS=Huge,Titanic,Gargantuan,Secret
STORE_PATH=/data/store.json
```

Add a Railway volume mounted at `/data` so OAuth tokens, baselines, and tracked pets survive redeploys.

## Watch Rules

By default, this watches pet category/name keywords:

```text
Huge,Titanic,Gargantuan,Secret
```

Add custom pets from Discord with slash commands:

```text
/track pet:Huge Cosmic Axolotl
/untrack pet:Huge Cosmic Axolotl
/tracked
```

`/tracked` shows the tracked pet list plus the latest known count, category, rarity, RAP, and exists count from your latest inventory snapshot.

The tracker matches exact custom pet names first, then keyword matches against `category`, `displayName`, and `id`.

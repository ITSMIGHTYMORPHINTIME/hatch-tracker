const path = require("node:path");
require("dotenv").config();

function required(name) {
  const value = process.env[name];
  if (!value || value.includes("replace_with")) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function csv(name, fallback = "") {
  return (process.env[name] || fallback)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const scopes = (process.env.BIG_GAMES_SCOPES || "player-data:pet-simulator-99:inventory:read player-data:pet-simulator-99:profile:read")
  .split(/\s+/)
  .map((scope) => scope.trim())
  .filter(Boolean);

const storePath = process.env.STORE_PATH ||
  (process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, "store.json")
    : path.join(process.cwd(), "data", "store.json"));

module.exports = {
  port: Number(process.env.PORT || 3000),
  pollIntervalMs: Number(process.env.POLL_INTERVAL_MINUTES || 6) * 60 * 1000,
  storePath,
  discord: {
    token: required("DISCORD_BOT_TOKEN"),
    channelId: required("DISCORD_CHANNEL_ID"),
    userId: process.env.DISCORD_USER_ID || "",
    guildId: process.env.DISCORD_GUILD_ID || ""
  },
  bigGames: {
    clientId: required("BIG_GAMES_CLIENT_ID"),
    clientSecret: required("BIG_GAMES_CLIENT_SECRET"),
    redirectUri: required("BIG_GAMES_REDIRECT_URI"),
    scopes
  },
  watch: {
    pets: csv("WATCH_PETS"),
    keywords: csv("WATCH_KEYWORDS", "Huge,Titanic,Gargantuan,Secret")
  }
};

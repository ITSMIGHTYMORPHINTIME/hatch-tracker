const config = require("./config");
const { getInventory } = require("./biggames");
const { createDiscordBot } = require("./discord");
const { createServer } = require("./server");
const { createStore } = require("./store");
const { createTracker } = require("./tracker");

async function main() {
  const store = createStore(config.storePath);
  let discord;
  const notifier = {
    send: async (message) => discord.send(message)
  };
  const tracker = createTracker({
    config,
    store,
    notifier,
    bigGames: { getInventory }
  });
  discord = createDiscordBot({
    config: config.discord,
    store,
    tracker,
    watch: config.watch
  });
  const app = createServer({ config, store, tracker });

  tracker.start();

  app.listen(config.port, () => {
    console.log(`PS99 tracker listening at http://localhost:${config.port}`);
    console.log(`Connect BIG Games account at http://localhost:${config.port}/auth/start`);
  });

  startDiscordWithRetry(discord);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

function startDiscordWithRetry(discord) {
  discord.start().catch((error) => {
    console.error("Discord startup failed:", error.message);
    console.error("The web server is still running. Check the bot token, guild ID, invite, and channel permissions.");
    setTimeout(() => startDiscordWithRetry(discord), 30000);
  });
}

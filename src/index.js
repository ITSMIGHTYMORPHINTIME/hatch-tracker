const config = require("./config");
const { getInventory } = require("./biggames");
const { createDiscordBot } = require("./discord");
const { createServer } = require("./server");
const { createStore } = require("./store");
const { createTracker } = require("./tracker");

async function main() {
  const store = createStore(config.storePath);
  const notifier = {
    send: async (message) => discord.send(message)
  };
  const tracker = createTracker({
    config,
    store,
    notifier,
    bigGames: { getInventory }
  });
  const discord = createDiscordBot({
    config: config.discord,
    store,
    tracker,
    watch: config.watch
  });
  const app = createServer({ config, store, tracker });

  await discord.start();
  tracker.start();

  app.listen(config.port, () => {
    console.log(`PS99 tracker listening at http://localhost:${config.port}`);
    console.log(`Connect BIG Games account at http://localhost:${config.port}/auth/start`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

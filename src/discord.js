const WebSocket = require("ws");

const DISCORD_API = "https://discord.com/api/v10";
const EPHEMERAL = 64;

const COMMANDS = [
  {
    name: "track",
    description: "Track a PS99 pet by name.",
    type: 1,
    options: [
      {
        name: "pet",
        description: "Exact pet name, like Huge Cosmic Axolotl.",
        type: 3,
        required: true
      }
    ]
  },
  {
    name: "untrack",
    description: "Stop tracking a PS99 pet by name.",
    type: 1,
    options: [
      {
        name: "pet",
        description: "Exact pet name to stop tracking.",
        type: 3,
        required: true
      }
    ]
  },
  {
    name: "tracked",
    description: "Show currently tracked pets and their latest known data.",
    type: 1
  }
];

function createDiscordNotifier(config) {
  async function api(path, options = {}) {
    const response = await fetch(`${DISCORD_API}${path}`, {
      ...options,
      headers: {
        Authorization: `Bot ${config.token}`,
        "Content-Type": "application/json",
        ...options.headers
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Discord API failed (${response.status}) ${path}: ${errorText}`);
    }

    if (response.status === 204) return null;
    return response.json();
  }

  async function send(message) {
    await api(`/channels/${config.channelId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: message,
        allowed_mentions: {
          users: config.userId ? [config.userId] : []
        }
      })
    });
  }

  return { api, send };
}

function createDiscordBot({ config, store, tracker, watch }) {
  const rest = createDiscordNotifier(config);
  let socket = null;
  let heartbeatTimer = null;
  let reconnectTimer = null;
  let sequence = null;
  let botUser = null;

  async function start() {
    botUser = await rest.api("/users/@me");
    await registerCommands(botUser.id);
    await connectGateway();
  }

  async function registerCommands(applicationId) {
    const path = config.guildId
      ? `/applications/${applicationId}/guilds/${config.guildId}/commands`
      : `/applications/${applicationId}/commands`;

    await rest.api(path, {
      method: "PUT",
      body: JSON.stringify(COMMANDS)
    });

    const scope = config.guildId ? `guild ${config.guildId}` : "global";
    console.log(`Registered Discord slash commands for ${scope}.`);
  }

  async function connectGateway() {
    const gateway = await rest.api("/gateway/bot");
    socket = new WebSocket(`${gateway.url}?v=10&encoding=json`);

    socket.on("message", (data) => {
      void handleGatewayMessage(JSON.parse(data.toString()));
    });

    socket.on("close", () => {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      scheduleReconnect();
    });

    socket.on("error", (error) => {
      console.error("Discord gateway error:", error.message);
    });
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connectGateway().catch((error) => {
        console.error("Discord reconnect failed:", error.message);
        scheduleReconnect();
      });
    }, 5000);
  }

  async function handleGatewayMessage(message) {
    if (message.s) sequence = message.s;

    if (message.op === 10) {
      startHeartbeat(message.d.heartbeat_interval);
      identify();
      return;
    }

    if (message.op === 9) {
      identify();
      return;
    }

    if (message.op !== 0) return;

    if (message.t === "READY") {
      console.log(`Discord bot connected as ${botUser?.username || "bot"}.`);
    }

    if (message.t === "INTERACTION_CREATE") {
      await handleInteraction(message.d);
    }
  }

  function startHeartbeat(intervalMs) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(() => {
      sendGateway({ op: 1, d: sequence });
    }, intervalMs);
  }

  function identify() {
    sendGateway({
      op: 2,
      d: {
        token: config.token,
        intents: 0,
        properties: {
          os: "windows",
          browser: "ps99-pet-tracker",
          device: "ps99-pet-tracker"
        }
      }
    });
  }

  function sendGateway(payload) {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(payload));
    }
  }

  async function handleInteraction(interaction) {
    if (interaction.type !== 2) return;

    const command = interaction.data.name;
    const petName = getStringOption(interaction, "pet");

    try {
      if (command === "track") {
        const result = store.trackPet(petName);
        const status = result.created
          ? `Now tracking **${result.pet.name}**. I refreshed the baseline so existing copies do not trigger fake alerts.`
          : `**${result.pet.name}** is already being tracked.`;
        await respond(interaction, status);
        if (result.created) void tracker.baselineAll();
        return;
      }

      if (command === "untrack") {
        const removed = store.untrackPet(petName);
        await respond(interaction, removed ? `Stopped tracking **${petName.trim()}**.` : `**${petName.trim()}** was not being tracked.`);
        return;
      }

      if (command === "tracked") {
        await respond(interaction, formatTrackedPets(store, watch));
      }
    } catch (error) {
      console.error(`Discord command /${command} failed:`, error.message);
      await respond(interaction, `Command failed: ${error.message}`);
    }
  }

  async function respond(interaction, content) {
    await fetch(`${DISCORD_API}/interactions/${interaction.id}/${interaction.token}/callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: 4,
        data: {
          content: truncateDiscordMessage(content),
          flags: EPHEMERAL,
          allowed_mentions: { parse: [] }
        }
      })
    });
  }

  return {
    send: rest.send,
    start
  };
}

function getStringOption(interaction, name) {
  const option = interaction.data.options?.find((item) => item.name === name);
  return String(option?.value || "").trim();
}

function formatTrackedPets(store, watch) {
  const trackedPets = store.getTrackedPets();
  const defaultKeywords = watch.keywords.join(", ");
  const lines = [`Automatic keyword tracking: ${defaultKeywords || "none"}`];

  if (trackedPets.length === 0) {
    lines.push("", "No custom pets are tracked yet. Use `/track pet:<name>` to add one.");
    return lines.join("\n");
  }

  lines.push("", "Custom tracked pets:");
  const snapshots = Object.values(store.readAllSnapshots());

  for (const pet of trackedPets) {
    const details = findTrackedPetDetails(pet, snapshots);
    if (!details) {
      lines.push(`- ${pet.name} | no inventory data yet`);
      continue;
    }

    const rap = details.rap ? formatNumber(details.rap) : "unknown";
    const exists = details.exists ? formatNumber(details.exists) : "unknown";
    lines.push(`- ${pet.name} | owned: ${formatNumber(details.count)} | ${details.category} | ${details.rarity} | RAP: ${rap} | exists: ${exists}`);
  }

  return lines.join("\n");
}

function findTrackedPetDetails(pet, snapshots) {
  const matches = snapshots
    .flatMap((snapshot) => Object.values(snapshot))
    .filter((item) => normalizePetName(item.displayName) === pet.normalized);

  if (matches.length === 0) return null;

  const count = matches.reduce((sum, item) => sum + Number(item.count || 0), 0);
  const sample = matches.find((item) => item.rap || item.exists || item.category || item.rarity) || matches[0];

  return {
    count,
    category: sample.category || "Unknown",
    rarity: sample.rarity || "Unknown",
    rap: Number(sample.rap || 0),
    exists: Number(sample.exists || 0)
  };
}

function normalizePetName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function truncateDiscordMessage(message) {
  if (message.length <= 1900) return message;
  return `${message.slice(0, 1897)}...`;
}

module.exports = { createDiscordBot, createDiscordNotifier };

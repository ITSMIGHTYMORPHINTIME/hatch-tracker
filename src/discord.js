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
  },
  {
    name: "check",
    description: "Run an inventory check right now.",
    type: 1
  },
  {
    name: "testalert",
    description: "Send a test alert to the configured alert channel.",
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
        await deferResponse(interaction);
        const result = store.trackPet(petName);
        const status = result.created
          ? `Now tracking **${result.pet.name}**. I refreshed the baseline so existing copies do not trigger fake alerts.`
          : `**${result.pet.name}** is already being tracked.`;
        if (result.created) await tracker.baselineAll();
        await editResponse(interaction, status);
        return;
      }

      if (command === "untrack") {
        const removed = store.untrackPet(petName);
        await respond(interaction, removed ? `Stopped tracking **${petName.trim()}**.` : `**${petName.trim()}** was not being tracked.`);
        return;
      }

      if (command === "tracked") {
        await respond(interaction, formatTrackedPets(store, watch));
        return;
      }

      if (command === "check") {
        await deferResponse(interaction);
        const results = await tracker.checkAll();
        await editResponse(interaction, formatCheckResults(results));
        return;
      }

      if (command === "testalert") {
        await deferResponse(interaction);
        const mention = config.userId ? `<@${config.userId}> ` : "";
        await rest.send(`${mention}Test alert from the PS99 hatch tracker. If you see this, alert channel pings work.`);
        await editResponse(interaction, "Sent a test alert to the configured alert channel.");
      }
    } catch (error) {
      console.error(`Discord command /${command} failed:`, error.message);
      await safeInteractionError(interaction, `Command failed: ${error.message}`);
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

  async function deferResponse(interaction) {
    const response = await fetch(`${DISCORD_API}/interactions/${interaction.id}/${interaction.token}/callback`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        type: 5,
        data: {
          flags: EPHEMERAL
        }
      })
    });

    if (!response.ok) {
      throw new Error(`Discord defer failed (${response.status}): ${await response.text()}`);
    }
  }

  async function editResponse(interaction, content) {
    const response = await fetch(`${DISCORD_API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        content: truncateDiscordMessage(content),
        allowed_mentions: { parse: [] }
      })
    });

    if (!response.ok) {
      throw new Error(`Discord response edit failed (${response.status}): ${await response.text()}`);
    }
  }

  async function safeInteractionError(interaction, content) {
    try {
      await editResponse(interaction, content);
    } catch {
      await respond(interaction, content);
    }
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
  const snapshots = Object.values(store.readAllSnapshots());
  const automatic = findAutomaticTrackedDetails(watch, snapshots);

  if (automatic.length > 0) {
    lines.push("", "Automatic tracked pets seen in your inventory:");
    for (const item of automatic.slice(0, 25)) {
      const rap = item.rap ? formatNumber(item.rap) : "unknown";
      const exists = item.exists ? formatNumber(item.exists) : "unknown";
      lines.push(`- ${item.displayName} | owned: ${formatNumber(item.count)} | ${item.category} | ${item.rarity} | RAP: ${rap} | exists: ${exists}`);
    }
    if (automatic.length > 25) {
      lines.push(`...and ${automatic.length - 25} more automatic matches.`);
    }
  } else {
    lines.push("", "No automatic Huge/Titanic/Gargantuan/Secret pets have been seen in your saved inventory snapshot yet.");
  }

  if (trackedPets.length === 0) {
    lines.push("", "No custom pets are tracked yet. Use `/track pet:<name>` to add one.");
    return lines.join("\n");
  }

  lines.push("", "Custom tracked pets:");

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

function findAutomaticTrackedDetails(watch, snapshots) {
  const byName = new Map();
  const items = snapshots.flatMap((snapshot) => Object.values(snapshot));

  for (const item of items) {
    const searchable = [item.category, item.displayName, item.id].filter(Boolean).join(" ").toLowerCase();
    const matched = watch.keywords.some((value) => searchable.includes(value.toLowerCase()));
    if (!matched) continue;

    const key = normalizePetName(item.displayName);
    const existing = byName.get(key);
    if (existing) {
      existing.count += Number(item.count || 0);
      existing.rap = Math.max(existing.rap, Number(item.rap || 0));
      existing.exists = Math.max(existing.exists, Number(item.exists || 0));
    } else {
      byName.set(key, {
        displayName: item.displayName,
        count: Number(item.count || 0),
        category: item.category || "Unknown",
        rarity: item.rarity || "Unknown",
        rap: Number(item.rap || 0),
        exists: Number(item.exists || 0)
      });
    }
  }

  return Array.from(byName.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
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

function formatCheckResults(results) {
  if (!results) {
    return "A check is already running. Try again in a moment.";
  }

  if (results.length === 0) {
    return "No BIG Games account is connected yet. Open your Railway `/auth/start` URL and approve the app first.";
  }

  const lines = ["Manual inventory check finished:"];

  for (const result of results) {
    if (result.error) {
      lines.push(`- ${result.player}: error - ${result.error}`);
      continue;
    }

    const refresh = result.refresh
      ? ` | cache: ${result.refresh.skipped || "unknown"} | quota ${result.refresh.used ?? "?"}/${result.refresh.limit ?? "?"}`
      : "";

    if (result.baseline) {
      lines.push(`- ${result.player}: saved first baseline, no alert sent${refresh}`);
      continue;
    }

    if (result.changes.length === 0) {
      lines.push(`- ${result.player}: no new tracked pet count increases found${refresh}`);
      continue;
    }

    lines.push(`- ${result.player}: found ${result.changes.length} tracked increase(s) and sent alert${refresh}`);
  }

  return lines.join("\n");
}

function truncateDiscordMessage(message) {
  if (message.length <= 1900) return message;
  return `${message.slice(0, 1897)}...`;
}

module.exports = { createDiscordBot, createDiscordNotifier };

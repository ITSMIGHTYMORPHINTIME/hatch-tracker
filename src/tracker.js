function watchedPetMatch(item, watch, trackedPets) {
  if (item.class !== "Pet") return null;

  const displayName = item.displayName || item.id || "";
  const normalizedDisplayName = normalizePetName(displayName);
  const exact = trackedPets.find((pet) => pet.normalized === normalizedDisplayName);
  if (exact) return `tracked pet "${exact.name}"`;

  const envExact = watch.pets.find((petName) => normalizePetName(petName) === normalizedDisplayName);
  if (envExact) return `env pet "${envExact}"`;

  const searchable = [item.category, item.displayName, item.id].filter(Boolean).join(" ").toLowerCase();
  const keyword = watch.keywords.find((value) => searchable.includes(value.toLowerCase()));
  return keyword ? `keyword "${keyword}"` : null;
}

function inventoryToCounts(inventory, watch, trackedPets) {
  const counts = {};
  const items = inventory?.data?.items || [];

  for (const item of items) {
    if (item.class !== "Pet") continue;
    const reason = watchedPetMatch(item, watch, trackedPets);

    const key = item.stackKey || `${item.id}:${JSON.stringify(item.rawData || {})}`;
    counts[key] = {
      count: Number(item.count || 1),
      displayName: item.displayName || item.id,
      id: item.id,
      category: item.category || "Unknown",
      rarity: item.rarity || "Unknown",
      rap: Number(item.rap || 0),
      exists: Number(item.exists || 0),
      reason,
      tracked: Boolean(reason)
    };
  }

  return counts;
}

function diffCounts(previous, current) {
  const changes = [];

  for (const [key, item] of Object.entries(current)) {
    if (!item.tracked) continue;
    const oldCount = Number(previous[key]?.count || 0);
    if (item.count > oldCount) {
      changes.push({
        ...item,
        gained: item.count - oldCount
      });
    }
  }

  return changes;
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatNotification(token, changes, discordUserId, refresh) {
  const mention = discordUserId ? `<@${discordUserId}> ` : "";
  const lines = changes.map((item) => {
    const rap = item.rap ? ` | RAP: ${formatNumber(item.rap)}` : "";
    const exists = item.exists ? ` | Exists: ${formatNumber(item.exists)}` : "";
    return `- +${item.gained} ${item.displayName} (${item.category}, ${item.reason})${rap}${exists}`;
  });

  const refreshNote = refresh?.quotaExhausted
    ? "\nNote: BIG Games refresh quota is exhausted, so future checks may stay stale until reset."
    : "";

  return `${mention}New watched PS99 pet detected for **${token.displayName || token.username || token.robloxUserId}**:\n${lines.join("\n")}${refreshNote}`;
}

function createTracker({ config, store, bigGames, notifier }) {
  let running = false;

  async function checkToken(token) {
    const inventory = await bigGames.getInventory(token.accessToken);
    const current = inventoryToCounts(inventory, config.watch, store.getTrackedPets());
    const snapshotKey = token.robloxUserId || token.tokenId;
    const previous = store.getSnapshot(snapshotKey);
    const changes = diffCounts(previous, current);

    if (Object.keys(previous).length === 0) {
      console.log(`Saved first inventory baseline for ${token.displayName || token.robloxUserId}.`);
      store.saveSnapshot(snapshotKey, current);
      return {
        player: token.displayName || token.username || token.robloxUserId,
        baseline: true,
        changes: [],
        refresh: inventory.refresh
      };
    }

    if (changes.length > 0) {
      await notifier.send(formatNotification(token, changes, config.discord.userId, inventory.refresh));
    }

    store.saveSnapshot(snapshotKey, current);
    return {
      player: token.displayName || token.username || token.robloxUserId,
      baseline: false,
      changes,
      refresh: inventory.refresh
    };
  }

  async function baselineToken(token) {
    const inventory = await bigGames.getInventory(token.accessToken);
    const current = inventoryToCounts(inventory, config.watch, store.getTrackedPets());
    const snapshotKey = token.robloxUserId || token.tokenId;
    store.saveSnapshot(snapshotKey, current);
  }

  async function checkAll() {
    if (running) return;
    running = true;
    const results = [];
    try {
      const tokens = store.getTokens();
      for (const token of tokens) {
        try {
          results.push(await checkToken(token));
        } catch (error) {
          console.error(`Tracker check failed for ${token.displayName || token.robloxUserId}:`, error.message);
          results.push({
            player: token.displayName || token.username || token.robloxUserId,
            error: error.message
          });
        }
      }
      return results;
    } finally {
      running = false;
    }
  }

  async function baselineAll() {
    const tokens = store.getTokens();
    for (const token of tokens) {
      try {
        await baselineToken(token);
      } catch (error) {
        console.error(`Baseline refresh failed for ${token.displayName || token.robloxUserId}:`, error.message);
      }
    }
  }

  function start() {
    setInterval(checkAll, config.pollIntervalMs);
    void checkAll();
  }

  return { baselineAll, checkAll, start };
}

function normalizePetName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

module.exports = { createTracker, formatNumber };

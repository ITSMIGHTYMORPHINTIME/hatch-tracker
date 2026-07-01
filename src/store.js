const fs = require("node:fs");
const path = require("node:path");

function createStore(filePath) {
  function ensure() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify({ tokens: [], snapshots: {}, oauthStates: {}, trackedPets: [] }, null, 2));
    }
  }

  function read() {
    ensure();
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    data.tokens ||= [];
    data.snapshots ||= {};
    data.oauthStates ||= {};
    data.trackedPets ||= [];
    return data;
  }

  function write(data) {
    ensure();
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  }

  function saveOauthState(state, verifier) {
    const data = read();
    data.oauthStates[state] = {
      verifier,
      createdAt: new Date().toISOString()
    };
    write(data);
  }

  function consumeOauthState(state) {
    const data = read();
    const entry = data.oauthStates[state];
    if (!entry) return null;
    delete data.oauthStates[state];
    write(data);
    return entry.verifier;
  }

  function upsertToken(token) {
    const data = read();
    const existingIndex = data.tokens.findIndex((entry) => entry.robloxUserId === token.robloxUserId);
    if (existingIndex >= 0) {
      data.tokens[existingIndex] = token;
    } else {
      data.tokens.push(token);
    }
    write(data);
  }

  function getTokens() {
    return read().tokens;
  }

  function getSnapshot(key) {
    return read().snapshots[key] || {};
  }

  function saveSnapshot(key, snapshot) {
    const data = read();
    data.snapshots[key] = snapshot;
    write(data);
  }

  function readAllSnapshots() {
    return read().snapshots;
  }

  function getTrackedPets() {
    return read().trackedPets;
  }

  function trackPet(name) {
    const normalized = normalizePetName(name);
    const data = read();
    const existing = data.trackedPets.find((pet) => pet.normalized === normalized);
    if (existing) return { pet: existing, created: false };

    const pet = {
      name: name.trim(),
      normalized,
      createdAt: new Date().toISOString()
    };
    data.trackedPets.push(pet);
    data.trackedPets.sort((a, b) => a.name.localeCompare(b.name));
    write(data);
    return { pet, created: true };
  }

  function untrackPet(name) {
    const normalized = normalizePetName(name);
    const data = read();
    const before = data.trackedPets.length;
    data.trackedPets = data.trackedPets.filter((pet) => pet.normalized !== normalized);
    write(data);
    return before !== data.trackedPets.length;
  }

  return {
    consumeOauthState,
    getSnapshot,
    getTokens,
    getTrackedPets,
    readAllSnapshots,
    saveOauthState,
    saveSnapshot,
    trackPet,
    untrackPet,
    upsertToken
  };
}

function normalizePetName(name) {
  return String(name || "").trim().toLowerCase().replace(/\s+/g, " ");
}

module.exports = { createStore };

const crypto = require("node:crypto");

const BIG_GAMES_API = "https://ps99.biggamesapi.io";
const BIG_GAMES_AUTH = "https://db.biggames.io";

function base64Url(buffer) {
  return buffer.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(64)).slice(0, 128);
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function createState() {
  return base64Url(crypto.randomBytes(32));
}

function createAuthorizeUrl(config, state, challenge) {
  const url = new URL("/oauth/authorize", BIG_GAMES_AUTH);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  return url.toString();
}

async function exchangeCode(config, code, verifier) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: config.redirectUri,
    code_verifier: verifier
  });

  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetch(`${BIG_GAMES_AUTH}/oauth/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${JSON.stringify(json)}`);
  }

  return json;
}

async function accountRequest(accessToken, endpoint) {
  const response = await fetch(`${BIG_GAMES_API}/v1/account/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  const json = await response.json();
  if (!response.ok || json.status !== "ok") {
    const retryAfter = response.headers.get("retry-after");
    const suffix = retryAfter ? ` Retry after ${retryAfter}s.` : "";
    throw new Error(`BIG Games ${endpoint} request failed: ${JSON.stringify(json)}.${suffix}`);
  }

  return json;
}

async function getProfile(accessToken) {
  return accountRequest(accessToken, "profile");
}

async function getInventory(accessToken) {
  return accountRequest(accessToken, "inventory");
}

module.exports = {
  createAuthorizeUrl,
  createPkcePair,
  createState,
  exchangeCode,
  getInventory,
  getProfile
};

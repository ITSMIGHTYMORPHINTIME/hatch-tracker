const express = require("express");
const {
  createAuthorizeUrl,
  createPkcePair,
  createState,
  exchangeCode,
  getProfile
} = require("./biggames");

function createServer({ config, store, tracker }) {
  const app = express();

  app.get("/", (_request, response) => {
    response.type("text/plain").send("PS99 tracker is running. Visit /auth/start to connect your BIG Games account.");
  });

  app.get("/auth/start", (_request, response) => {
    const state = createState();
    const { verifier, challenge } = createPkcePair();
    store.saveOauthState(state, verifier);
    response.redirect(createAuthorizeUrl(config.bigGames, state, challenge));
  });

  app.get("/oauth/callback", async (request, response, next) => {
    try {
      if (request.query.error) {
        response.status(400).type("text/plain").send(`Authorization failed: ${request.query.error}`);
        return;
      }

      const code = String(request.query.code || "");
      const state = String(request.query.state || "");
      const verifier = store.consumeOauthState(state);

      if (!code || !state || !verifier) {
        response.status(400).type("text/plain").send("Missing or invalid OAuth callback state.");
        return;
      }

      const tokenResponse = await exchangeCode(config.bigGames, code, verifier);
      const profile = await getProfile(tokenResponse.access_token);
      const profileData = profile.data || {};
      const robloxUserId = String(profileData.RobloxUserId || profileData.robloxUserId || profileData.UserId || cryptoRandomId());

      store.upsertToken({
        tokenId: cryptoRandomId(),
        accessToken: tokenResponse.access_token,
        expiresAt: new Date(Date.now() + Number(tokenResponse.expires_in || 0) * 1000).toISOString(),
        scope: tokenResponse.scope || "",
        robloxUserId,
        username: profileData.Username || profileData.username || "",
        displayName: profileData.DisplayName || profileData.displayName || profileData.Username || ""
      });

      await tracker.checkAll();
      response.type("text/plain").send("Connected! You can close this tab. The Discord tracker is now watching your inventory.");
    } catch (error) {
      next(error);
    }
  });

  app.use((error, _request, response, _next) => {
    console.error(error);
    response.status(500).type("text/plain").send(error.message);
  });

  return app;
}

function cryptoRandomId() {
  return Math.random().toString(36).slice(2);
}

module.exports = { createServer };

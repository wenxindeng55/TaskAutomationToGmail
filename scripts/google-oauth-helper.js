const crypto = require("node:crypto");
const http = require("node:http");

const SCOPE = "https://www.googleapis.com/auth/gmail.send";
const PORT = Number(process.env.OAUTH_PORT || 8789);
const HOST = "127.0.0.1";
const REDIRECT_URI = `http://${HOST}:${PORT}/oauth2callback`;

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function base64UrlEncode(buffer) {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function makePkcePair() {
  const verifier = base64UrlEncode(crypto.randomBytes(64));
  const challenge = base64UrlEncode(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function exchangeCode({ clientId, clientSecret, code, verifier }) {
  const body = new URLSearchParams({
    client_id: clientId,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI
  });

  if (clientSecret) {
    body.set("client_secret", clientSecret);
  }

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Token exchange failed: ${JSON.stringify(payload, null, 2)}`);
  }
  return payload;
}

async function main() {
  const clientId = requiredEnv("GOOGLE_CLIENT_ID");
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const state = base64UrlEncode(crypto.randomBytes(24));
  const { verifier, challenge } = makePkcePair();

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", clientId);
  authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, REDIRECT_URI);
    if (url.pathname !== "/oauth2callback") {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    if (url.searchParams.get("state") !== state) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Invalid OAuth state.");
      server.close();
      return;
    }

    const error = url.searchParams.get("error");
    if (error) {
      res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(`Google returned OAuth error: ${error}`);
      server.close();
      return;
    }

    try {
      const code = url.searchParams.get("code");
      if (!code) throw new Error("Missing OAuth code");
      const token = await exchangeCode({ clientId, clientSecret, code, verifier });

      res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Authorization complete. You can close this browser tab and return to the terminal.");

      console.log("");
      console.log("Add these GitHub repository secrets:");
      console.log(`GOOGLE_CLIENT_ID=${clientId}`);
      if (clientSecret) console.log("GOOGLE_CLIENT_SECRET=<the client secret you used>");
      console.log(`GOOGLE_REFRESH_TOKEN=${token.refresh_token || "<missing refresh token; rerun with prompt=consent>"}`);
      console.log("");
      console.log("Optional:");
      console.log("GOOGLE_SENDER_EMAIL=<the Gmail address you authorized>");
      console.log("AI_UPDATES_RECIPIENT=deng1543659807@gmail.com");
    } catch (exchangeError) {
      res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      res.end(exchangeError.message);
      console.error(exchangeError);
    } finally {
      server.close();
    }
  });

  server.listen(PORT, HOST, () => {
    console.log(`OAuth callback server is listening on ${REDIRECT_URI}`);
    console.log("");
    console.log("Open this URL in your browser:");
    console.log(authUrl.toString());
    console.log("");
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

/**
 * OAuth 2.0 + PKCE Authentication for Claude Max/Pro
 * Similar to Claude Code authentication flow
 */

import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { exec } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigDir, ensureConfigDir, loadConfig } from '../config/index.js';

const ANTHROPIC_AUTH_URL = 'https://console.anthropic.com/oauth/authorize';
const ANTHROPIC_TOKEN_URL = 'https://console.anthropic.com/oauth/token';
const CLIENT_ID = 'osbot-cli';

interface TokenData {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  token_type: string;
}

function getTokenPath(): string {
  return join(getConfigDir(), 'oauth-token.json');
}

/**
 * Generate PKCE code verifier and challenge
 */
function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/**
 * Open URL in default browser
 */
function openBrowser(url: string): void {
  const platform = process.platform;
  let command: string;

  if (platform === 'win32') {
    command = `start "" "${url}"`;
  } else if (platform === 'darwin') {
    command = `open "${url}"`;
  } else {
    command = `xdg-open "${url}"`;
  }

  exec(command, (error) => {
    if (error) {
      console.error('Failed to open browser. Please open this URL manually:');
      console.error(url);
    }
  });
}

/**
 * Start OAuth login flow
 */
export async function login(): Promise<TokenData> {
  ensureConfigDir();

  const config = loadConfig();
  const redirectPort = config.redirectPort;
  const redirectUri = `http://localhost:${redirectPort}/callback`;

  const { verifier, challenge } = generatePKCE();
  const state = randomBytes(16).toString('hex');

  // Build authorization URL
  const authUrl = new URL(ANTHROPIC_AUTH_URL);
  authUrl.searchParams.set('client_id', CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('code_challenge', challenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('scope', 'user:inference');

  return new Promise((resolve, reject) => {
    // Start local server to receive callback
    const server = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${redirectPort}`);

      if (url.pathname === '/callback') {
        const code = url.searchParams.get('code');
        const returnedState = url.searchParams.get('state');
        const error = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Authentication failed</h1><p>${error}</p></body></html>`);
          server.close();
          reject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (returnedState !== state) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Authentication failed</h1><p>State mismatch</p></body></html>');
          server.close();
          reject(new Error('State mismatch'));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<html><body><h1>Authentication failed</h1><p>No code received</p></body></html>');
          server.close();
          reject(new Error('No authorization code received'));
          return;
        }

        try {
          // Exchange code for token
          const tokenResponse = await fetch(ANTHROPIC_TOKEN_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
              grant_type: 'authorization_code',
              client_id: CLIENT_ID,
              code,
              redirect_uri: redirectUri,
              code_verifier: verifier,
            }),
          });

          if (!tokenResponse.ok) {
            const errorText = await tokenResponse.text();
            throw new Error(`Token exchange failed: ${errorText}`);
          }

          const tokenData = (await tokenResponse.json()) as TokenData;

          // Calculate expiration time
          if (tokenData.expires_at === undefined) {
            // Default to 1 hour if not provided
            tokenData.expires_at = Date.now() + 3600 * 1000;
          }

          // Save token
          saveToken(tokenData);

          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html>
              <body style="font-family: system-ui; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0;">
                <div style="text-align: center;">
                  <h1 style="color: #22c55e;">✓ Authentication successful!</h1>
                  <p>You can close this window and return to the terminal.</p>
                </div>
              </body>
            </html>
          `);

          server.close();
          resolve(tokenData);
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<html><body><h1>Authentication failed</h1><p>${err}</p></body></html>`);
          server.close();
          reject(err);
        }
      } else {
        res.writeHead(404);
        res.end('Not found');
      }
    });

    server.listen(redirectPort, () => {
      console.log(`Opening browser for authentication...`);
      console.log(`If browser doesn't open, visit: ${authUrl.toString()}`);
      openBrowser(authUrl.toString());
    });

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close();
      reject(new Error('Authentication timed out'));
    }, 5 * 60 * 1000);
  });
}

/**
 * Save token to disk
 */
function saveToken(token: TokenData): void {
  ensureConfigDir();
  writeFileSync(getTokenPath(), JSON.stringify(token, null, 2));
}

/**
 * Load token from disk
 */
export function loadToken(): TokenData | null {
  const tokenPath = getTokenPath();
  if (!existsSync(tokenPath)) {
    return null;
  }

  try {
    const data = readFileSync(tokenPath, 'utf-8');
    return JSON.parse(data) as TokenData;
  } catch {
    return null;
  }
}

/**
 * Check if token is expired
 */
export function isTokenExpired(token: TokenData): boolean {
  if (!token.expires_at) {
    return false;
  }
  // Consider expired if less than 5 minutes remaining
  return Date.now() > token.expires_at - 5 * 60 * 1000;
}

/**
 * Refresh access token
 */
export async function refreshToken(token: TokenData): Promise<TokenData> {
  if (!token.refresh_token) {
    throw new Error('No refresh token available. Please login again.');
  }

  const response = await fetch(ANTHROPIC_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      refresh_token: token.refresh_token,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to refresh token. Please login again.');
  }

  const newToken = (await response.json()) as TokenData;

  if (newToken.expires_at === undefined) {
    newToken.expires_at = Date.now() + 3600 * 1000;
  }

  // Keep refresh token if not returned
  if (!newToken.refresh_token && token.refresh_token) {
    newToken.refresh_token = token.refresh_token;
  }

  saveToken(newToken);
  return newToken;
}

/**
 * Get valid access token (refresh if needed)
 */
export async function getAccessToken(): Promise<string> {
  let token = loadToken();

  if (!token) {
    throw new Error('Not logged in. Run "osbot login" first.');
  }

  if (isTokenExpired(token)) {
    try {
      token = await refreshToken(token);
    } catch {
      throw new Error('Session expired. Run "osbot login" to re-authenticate.');
    }
  }

  return token.access_token;
}

/**
 * Check if user is logged in
 */
export function isLoggedIn(): boolean {
  const token = loadToken();
  return token !== null;
}

/**
 * Logout - remove stored token
 */
export function logout(): void {
  const tokenPath = getTokenPath();
  if (existsSync(tokenPath)) {
    unlinkSync(tokenPath);
  }
}

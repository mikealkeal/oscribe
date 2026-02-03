  /**
 * Browser restart with CDP support
 * Saves open tabs, closes browser, relaunches with remote debugging
 */

import { execSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { BrowserType, detectBrowser, isCDPEnabled } from './browser.js';
import { connectCDP, disconnectCDP } from './cdp-client.js';
import { getActiveWindow } from './windows.js';

const LOG_FILE = join(homedir(), 'Desktop', 'oscribe-browser-restart.log');

function log(message: string): void {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}\n`;
  console.error(line.trim());
  try {
    appendFileSync(LOG_FILE, line, 'utf8');
  } catch (err) {
    console.error(`Failed to write to log file ${LOG_FILE}:`, err);
  }
}

// Test log on module load to verify file writing works
try {
  log('=== BROWSER-RESTART MODULE LOADED ===');
  log(`Log file path: ${LOG_FILE}`);
  log(`Platform: ${process.platform}`);
  log(`Process: PID=${process.pid}, cwd=${process.cwd()}`);
} catch (err) {
  console.error('Failed to initialize log file:', err);
}

export interface BrowserRestartResult {
  success: boolean;
  browser: BrowserType;
  tabsSaved: number;
  tabsRestored: number;
  cdpEnabled: boolean;
  error?: string;
}

/**
 * Get the default Chrome profile path for the current platform
 */
function getDefaultChromeProfilePath(): string {
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library/Application Support/Google/Chrome');
  } else if (process.platform === 'win32') {
    return join(process.env['APPDATA'] || '', 'Google/Chrome/User Data');
  } else {
    // Linux
    return join(homedir(), '.config/google-chrome');
  }
}

/**
 * Get the OScribe Chrome profile path
 */
function getOScribeProfilePath(): string {
  return join(homedir(), '.oscribe/chrome-profile');
}

/**
 * Synchronize Chrome default profile to OScribe profile directory
 * ALWAYS copies to ensure latest extensions/cookies/logins
 * Uses rsync on Unix (faster than cp for updates), xcopy on Windows
 */
async function syncProfileToOScribe(): Promise<boolean> {
  log('Synchronizing Chrome profile to OScribe directory...');
  const defaultProfile = getDefaultChromeProfilePath();
  const oscribeProfile = getOScribeProfilePath();

  try {
    // Create parent directory if needed
    const parentDir = dirname(oscribeProfile);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // Remove old OScribe profile if exists (clean slate)
    if (existsSync(oscribeProfile)) {
      log('Removing old OScribe profile...');
      if (process.platform === 'win32') {
        execSync(`rmdir /s /q "${oscribeProfile}"`, { timeout: 30000 });
      } else {
        execSync(`rm -rf "${oscribeProfile}"`, { timeout: 30000 });
      }
    }

    // Copy profile
    // Use rsync on Unix (faster), xcopy on Windows
    log('Copying profile... (this may take a moment for large profiles)');
    if (process.platform === 'win32') {
      execSync(`xcopy "${defaultProfile}" "${oscribeProfile}" /E /I /H /Y /Q`, { timeout: 120000 });
    } else {
      // Use rsync if available (faster), fallback to cp
      try {
        execSync(`rsync -a "${defaultProfile}/" "${oscribeProfile}/"`, { timeout: 120000 });
      } catch {
        execSync(`cp -R "${defaultProfile}" "${oscribeProfile}"`, { timeout: 120000 });
      }
    }

    log('Profile synchronized successfully');
    return true;
  } catch (error) {
    log(`ERROR: Failed to sync profile: ${error}`);
    return false;
  }
}

/**
 * Get all open tabs from a browser via CDP
 * Must be called BEFORE closing the browser
 */
async function getOpenTabs(port = 9222): Promise<string[]> {
  try {
    // Check if CDP is already enabled
    if (!(await isCDPEnabled(port))) {
      // CDP not enabled yet - try to get tabs via AppleScript (macOS only)
      if (process.platform === 'darwin') {
        return await getTabsViaAppleScript();
      }
      return [];
    }

    // Connect to CDP
    const cdp = await connectCDP({ port, host: 'localhost' });

    // Get all targets (tabs)
    const { targetInfos } = await cdp.Target.getTargets({});

    // Extract URLs from page targets only
    const urls = targetInfos
      .filter((target) => target.type === 'page' && target.url && !target.url.startsWith('chrome://'))
      .map((target) => target.url);

    await disconnectCDP(cdp);

    return urls;
  } catch (error) {
    console.warn('[browser-restart] Failed to get tabs via CDP:', error);

    // Fallback: try AppleScript on macOS
    if (process.platform === 'darwin') {
      return await getTabsViaAppleScript();
    }

    return [];
  }
}

/**
 * Get tabs via AppleScript (macOS fallback when CDP not available)
 */
async function getTabsViaAppleScript(): Promise<string[]> {
  if (process.platform !== 'darwin') return [];

  try {
    const script = `
      tell application "Google Chrome"
        set tabUrls to {}
        repeat with w in windows
          repeat with t in tabs of w
            set end of tabUrls to URL of t
          end repeat
        end repeat
        return tabUrls
      end tell
    `;

    const result = execSync(`osascript -e '${script.replace(/'/g, "'\\''")}'`, {
      encoding: 'utf-8',
      timeout: 10000,
    });

    // Parse AppleScript result (comma-separated list)
    return result
      .trim()
      .split(', ')
      .filter((url) => url && !url.startsWith('chrome://'));
  } catch (error) {
    console.warn('[browser-restart] Failed to get tabs via AppleScript:', error);
    return [];
  }
}

/**
 * Close browser process
 */
async function closeBrowser(browserType: BrowserType): Promise<boolean> {
  const event = {
    action: 'close_browser',
    browser: browserType,
    timestamp: new Date().toISOString(),
    success: false,
  };

  try {
    if (process.platform === 'darwin') {
      // macOS: Use osascript to quit gracefully
      const appNames: Record<BrowserType, string> = {
        chrome: 'Google Chrome',
        edge: 'Microsoft Edge',
        brave: 'Brave Browser',
        arc: 'Arc',
        opera: 'Opera',
        chromium: 'Chromium',
        unknown: '',
      };

      const appName = appNames[browserType];
      if (!appName) {
        throw new Error(`Unknown browser type: ${browserType}`);
      }

      execSync(`osascript -e 'quit app "${appName}"'`, { timeout: 5000 });

      // Wait for process to fully close
      await new Promise((resolve) => setTimeout(resolve, 2000));

      event.success = true;
      console.log('[browser-restart]', event);
      return true;
    } else if (process.platform === 'win32') {
      // Windows: Use taskkill
      const processNames: Record<BrowserType, string> = {
        chrome: 'chrome.exe',
        edge: 'msedge.exe',
        brave: 'brave.exe',
        arc: 'arc.exe',
        opera: 'opera.exe',
        chromium: 'chromium.exe',
        unknown: '',
      };

      const processName = processNames[browserType];
      if (!processName) {
        throw new Error(`Unknown browser type: ${browserType}`);
      }

      execSync(`taskkill /F /IM ${processName}`, { timeout: 5000 });

      // Wait for process to fully close
      await new Promise((resolve) => setTimeout(resolve, 2000));

      event.success = true;
      console.log('[browser-restart]', event);
      return true;
    } else if (process.platform === 'linux') {
      // Linux: Use pkill
      const processNames: Record<BrowserType, string> = {
        chrome: 'chrome',
        edge: 'msedge',
        brave: 'brave',
        arc: 'arc',
        opera: 'opera',
        chromium: 'chromium',
        unknown: '',
      };

      const processName = processNames[browserType];
      if (!processName) {
        throw new Error(`Unknown browser type: ${browserType}`);
      }

      execSync(`pkill -f ${processName}`, { timeout: 5000 });

      // Wait for process to fully close
      await new Promise((resolve) => setTimeout(resolve, 2000));

      event.success = true;
      console.log('[browser-restart]', event);
      return true;
    }

    throw new Error(`Unsupported platform: ${process.platform}`);
  } catch (error) {
    console.error('[browser-restart]', event);
    return false;
  }
}

/**
 * Launch browser with remote debugging enabled
 */
async function launchBrowserWithCDP(browserType: BrowserType, port = 9222): Promise<boolean> {
  const event = {
    action: 'launch_browser_cdp',
    browser: browserType,
    port,
    timestamp: new Date().toISOString(),
    success: false,
  };

  try {
    if (process.platform === 'darwin') {
      // macOS: Use direct binary path (open -a with --args doesn't work reliably)
      const binaryPaths: Record<BrowserType, string> = {
        chrome: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        edge: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        brave: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
        arc: '/Applications/Arc.app/Contents/MacOS/Arc',
        opera: '/Applications/Opera.app/Contents/MacOS/Opera',
        chromium: '/Applications/Chromium.app/Contents/MacOS/Chromium',
        unknown: '',
      };

      const binaryPath = binaryPaths[browserType];
      if (!binaryPath) {
        throw new Error(`Unknown browser type: ${browserType}`);
      }

      // Launch browser with remote debugging using 'open' command
      // This ensures Chrome properly initializes CDP
      const appNames: Record<BrowserType, string> = {
        chrome: 'Google Chrome',
        edge: 'Microsoft Edge',
        brave: 'Brave Browser',
        arc: 'Arc',
        opera: 'Opera',
        chromium: 'Chromium',
        unknown: '',
      };

      const appName = appNames[browserType];
      if (!appName) {
        throw new Error(`Unknown browser type: ${browserType}`);
      }

      const oscribeProfile = getOScribeProfilePath();

      execSync(`open -a "${appName}" --args --remote-debugging-port=${port} --user-data-dir="${oscribeProfile}"`, {
        timeout: 5000,
      });
    } else if (process.platform === 'win32') {
      // Windows: Use start command
      const commands: Record<BrowserType, string> = {
        chrome: 'start chrome',
        edge: 'start msedge',
        brave: 'start brave',
        arc: 'start arc',
        opera: 'start opera',
        chromium: 'start chromium',
        unknown: '',
      };

      const command = commands[browserType];
      if (!command) {
        throw new Error(`Unknown browser type: ${browserType}`);
      }

      const oscribeProfile = getOScribeProfilePath();

      execSync(`${command} --remote-debugging-port=${port} --user-data-dir="${oscribeProfile}"`, { timeout: 5000 });
    } else if (process.platform === 'linux') {
      // Linux: Direct binary execution
      const binaries: Record<BrowserType, string> = {
        chrome: 'google-chrome',
        edge: 'microsoft-edge',
        brave: 'brave-browser',
        arc: 'arc',
        opera: 'opera',
        chromium: 'chromium',
        unknown: '',
      };

      const binary = binaries[browserType];
      if (!binary) {
        throw new Error(`Unknown browser type: ${browserType}`);
      }

      const oscribeProfile = getOScribeProfilePath();

      execSync(`${binary} --remote-debugging-port=${port} --user-data-dir="${oscribeProfile}" &`, { timeout: 5000 });
    } else {
      throw new Error(`Unsupported platform: ${process.platform}`);
    }

    // Wait for browser to start
    await new Promise((resolve) => setTimeout(resolve, 3000));

    event.success = true;
    console.log('[browser-restart]', event);
    return true;
  } catch (error) {
    console.error('[browser-restart]', event);
    return false;
  }
}

/**
 * Restore tabs by opening them in the browser
 */
async function restoreTabs(urls: string[], port = 9222): Promise<number> {
  if (urls.length === 0) return 0;

  try {
    // Wait for CDP to be ready
    let retries = 10;
    while (retries > 0 && !(await isCDPEnabled(port))) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      retries--;
    }

    if (!(await isCDPEnabled(port))) {
      console.warn('[browser-restart] CDP not ready after browser launch');
      return 0;
    }

    // Connect to CDP
    const cdp = await connectCDP({ port, host: 'localhost' });

    let restored = 0;

    // Create new tabs for each URL
    for (const url of urls) {
      try {
        await cdp.Target.createTarget({ url });
        restored++;
      } catch (error) {
        console.warn(`[browser-restart] Failed to restore tab: ${url}`, error);
      }
    }

    await disconnectCDP(cdp);

    return restored;
  } catch (error) {
    console.error('[browser-restart] Failed to restore tabs:', error);
    return 0;
  }
}

/**
 * Restart browser with CDP enabled
 * Saves tabs, closes browser, relaunches with remote debugging, restores tabs
 * @param port - Remote debugging port (default: 9222)
 * @param windowApp - Optional app name to target (e.g., "Google Chrome"). If not provided, uses active window.
 */
export async function restartBrowserWithCDP(port = 9222, windowApp?: string): Promise<BrowserRestartResult> {
  log(`>>> restartBrowserWithCDP called with port ${port}, windowApp=${windowApp || 'auto-detect'}`);
  const event = {
    action: 'restart_browser_cdp',
    port,
    windowApp: windowApp || 'auto-detect',
    timestamp: new Date().toISOString(),
    duration_ms: 0,
    success: false,
  };

  const start = Date.now();

  try {
    // 1. Detect browser
    log('Step 1: Detecting browser...');

    let targetApp: string;
    if (windowApp) {
      // Use provided app name
      log(`Using provided app name: ${windowApp}`);
      targetApp = windowApp;
    } else {
      // Fall back to active window detection
      log('No app name provided, detecting active window...');
      const activeWindow = await getActiveWindow();
      log(`Active window detected: ${JSON.stringify(activeWindow)}`);
      console.error('[browser-restart] Active window:', activeWindow);

      if (!activeWindow) {
        throw new Error('No active window detected');
      }
      if (!activeWindow.app) {
        throw new Error('Active window has no app name');
      }
      targetApp = activeWindow.app;
    }

    const browserInfo = await detectBrowser('', targetApp);
    log(`Browser info: ${JSON.stringify(browserInfo)}`);
    console.error('[browser-restart] Browser info:', browserInfo);

    if (!browserInfo) {
      log('ERROR: Browser not detected');
      throw new Error(`Window is not a supported Chromium browser (app: ${targetApp})`);
    }

    const browserType = browserInfo.type;
    log(`Browser type: ${browserType}`);

    // 2. Save open tabs
    log('Step 2: Saving open tabs...');
    console.log('[browser-restart] Saving open tabs...');
    const tabs = await getOpenTabs(port);
    log(`Saved ${tabs.length} tabs: ${JSON.stringify(tabs.slice(0, 3))}...`);
    console.log(`[browser-restart] Saved ${tabs.length} tabs`);

    // 3. Close browser
    log('Step 3: Closing browser...');
    console.log('[browser-restart] Closing browser...');
    const closed = await closeBrowser(browserType);
    log(`Browser closed: ${closed}`);
    if (!closed) {
      log('ERROR: Failed to close browser');
      throw new Error('Failed to close browser');
    }

    // 3.5. Synchronize profile (Chrome 136+ requirement for CDP)
    log('Step 3.5: Synchronizing profile to OScribe directory...');
    console.log('[browser-restart] Synchronizing Chrome profile for CDP compatibility...');
    const profileSynced = await syncProfileToOScribe();
    if (!profileSynced) {
      log('WARNING: Could not sync profile, CDP may not work correctly');
      console.warn('[browser-restart] Profile sync failed, continuing with fallback');
    }

    // 4. Launch with CDP
    log(`Step 4: Launching ${browserType} with CDP on port ${port}...`);
    console.log(`[browser-restart] Launching ${browserType} with CDP on port ${port}...`);
    const launched = await launchBrowserWithCDP(browserType, port);
    log(`Browser launched: ${launched}`);
    if (!launched) {
      log('ERROR: Failed to launch browser with CDP');
      throw new Error('Failed to launch browser with CDP');
    }

    // 5. Restore tabs
    log('Step 5: Restoring tabs...');
    console.log('[browser-restart] Restoring tabs...');
    const restored = await restoreTabs(tabs, port);
    log(`Restored ${restored}/${tabs.length} tabs`);
    console.log(`[browser-restart] Restored ${restored}/${tabs.length} tabs`);

    // 6. Verify CDP is enabled
    log('Step 6: Verifying CDP is enabled...');
    const cdpEnabled = await isCDPEnabled(port);
    log(`CDP enabled: ${cdpEnabled}`);

    event.duration_ms = Date.now() - start;
    event.success = true;
    log(`SUCCESS: Restart completed in ${event.duration_ms}ms`);
    console.log('[browser-restart]', event);

    return {
      success: true,
      browser: browserType,
      tabsSaved: tabs.length,
      tabsRestored: restored,
      cdpEnabled,
    };
  } catch (error) {
    event.duration_ms = Date.now() - start;
    log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    log(`Stack: ${error instanceof Error ? error.stack : 'N/A'}`);
    console.error('[browser-restart]', event);

    return {
      success: false,
      browser: 'unknown',
      tabsSaved: 0,
      tabsRestored: 0,
      cdpEnabled: false,
      error: String(error),
    };
  } finally {
    log('<<< restartBrowserWithCDP finished');
  }
}

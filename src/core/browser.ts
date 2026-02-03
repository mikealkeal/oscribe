/**
 * Browser Detection Module
 *
 * Detects Chromium-based browsers (Chrome, Edge, Brave, Arc, Opera) and checks
 * if remote debugging is enabled for CDP (Chrome DevTools Protocol) access.
 *
 * Cross-platform support: Windows, macOS, Linux
 */

// Branded type for browser process IDs
export type BrowserProcessId = string & { __brand: 'BrowserProcessId' };

// Supported Chromium-based browser types
export type BrowserType =
  | 'chrome'
  | 'edge'
  | 'brave'
  | 'arc'
  | 'opera'
  | 'chromium'
  | 'unknown';

export interface BrowserInfo {
  type: BrowserType;
  processId: BrowserProcessId;
  debugPort: number | null;
  isDebuggingEnabled: boolean;
  windowTitle: string;
  windowClass: string;
}

// Simple logger
const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => {
    if (process.env['DEBUG']) console.log(`[browser] ${msg}`, data ?? '');
  },
  info: (msg: string, data?: Record<string, unknown>) => {
    console.log(`[browser] ${msg}`, data ?? '');
  },
  warn: (msg: string, data?: Record<string, unknown>) => {
    console.warn(`[browser] ${msg}`, data ?? '');
  },
};

/**
 * Detect if a window is a Chromium-based browser
 *
 * @param windowClass - Window class name (Windows) or window title (macOS/Linux)
 * @param processName - Optional process name for additional detection
 * @returns BrowserInfo if browser detected, null otherwise
 */
export async function detectBrowser(
  windowClass: string,
  processName?: string
): Promise<BrowserInfo | null> {
  const platform = process.platform;

  console.error('[BROWSER DEBUG] detectBrowser called:', { windowClass, processName, platform });
  logger.debug('Detecting browser', { windowClass, processName, platform });

  // Platform-specific detection
  let browserType: BrowserType = 'unknown';
  let processId: BrowserProcessId = '' as BrowserProcessId;

  if (platform === 'win32') {
    // Windows: detect by window class
    browserType = detectBrowserWindows(windowClass, processName);
  } else if (platform === 'darwin') {
    // macOS: detect by app name
    browserType = detectBrowserMacOS(windowClass, processName);
  } else if (platform === 'linux') {
    // Linux: detect by window class
    browserType = detectBrowserLinux(windowClass, processName);
  }

  if (browserType === 'unknown') {
    logger.debug('Not a recognized Chromium browser');
    return null;
  }

  // Check if remote debugging is enabled
  console.error('[BROWSER DEBUG] Calling detectCDPPort...');
  const debugPort = await detectCDPPort();
  const isDebuggingEnabled = debugPort !== null;

  console.error('[BROWSER DEBUG] Browser detected:', {
    type: browserType,
    debugPort,
    isDebuggingEnabled,
  });

  logger.debug('Browser detected', {
    type: browserType,
    debugPort,
    isDebuggingEnabled,
  });

  return {
    type: browserType,
    processId,
    debugPort,
    isDebuggingEnabled,
    windowTitle: windowClass,
    windowClass,
  };
}

/**
 * Detect browser type on Windows based on window class
 */
function detectBrowserWindows(
  windowClass: string,
  processName?: string
): BrowserType {
  const classLower = windowClass.toLowerCase();
  const procLower = processName?.toLowerCase() ?? '';

  // Chrome
  if (classLower.includes('chrome_widgetwin') || procLower.includes('chrome')) {
    if (procLower.includes('msedge') || classLower.includes('edge')) {
      return 'edge';
    }
    if (procLower.includes('brave')) {
      return 'brave';
    }
    if (procLower.includes('opera')) {
      return 'opera';
    }
    return 'chrome';
  }

  // Edge (modern Chromium-based)
  if (
    classLower.includes('applicationframewindow') ||
    procLower.includes('msedge')
  ) {
    return 'edge';
  }

  // Brave
  if (procLower.includes('brave')) {
    return 'brave';
  }

  // Arc
  if (procLower.includes('arc')) {
    return 'arc';
  }

  // Opera
  if (procLower.includes('opera')) {
    return 'opera';
  }

  return 'unknown';
}

/**
 * Detect browser type on macOS based on app name
 */
function detectBrowserMacOS(
  windowTitle: string,
  appName?: string
): BrowserType {
  const titleLower = windowTitle.toLowerCase();
  const appLower = appName?.toLowerCase() ?? '';

  // Chrome
  if (appLower.includes('google chrome') || titleLower.includes('chrome')) {
    return 'chrome';
  }

  // Edge
  if (appLower.includes('microsoft edge') || titleLower.includes('edge')) {
    return 'edge';
  }

  // Brave
  if (appLower.includes('brave')) {
    return 'brave';
  }

  // Arc
  if (appLower.includes('arc')) {
    return 'arc';
  }

  // Opera
  if (appLower.includes('opera')) {
    return 'opera';
  }

  // Generic Chromium
  if (appLower.includes('chromium')) {
    return 'chromium';
  }

  return 'unknown';
}

/**
 * Detect browser type on Linux based on window class
 */
function detectBrowserLinux(
  windowClass: string,
  processName?: string
): BrowserType {
  const classLower = windowClass.toLowerCase();
  const procLower = processName?.toLowerCase() ?? '';

  // Chrome
  if (classLower.includes('chrome') || procLower.includes('chrome')) {
    return 'chrome';
  }

  // Edge
  if (classLower.includes('edge') || procLower.includes('msedge')) {
    return 'edge';
  }

  // Brave
  if (classLower.includes('brave') || procLower.includes('brave')) {
    return 'brave';
  }

  // Arc
  if (procLower.includes('arc')) {
    return 'arc';
  }

  // Opera
  if (classLower.includes('opera') || procLower.includes('opera')) {
    return 'opera';
  }

  // Generic Chromium
  if (classLower.includes('chromium') || procLower.includes('chromium')) {
    return 'chromium';
  }

  return 'unknown';
}

/**
 * Detect CDP port by checking default ports
 * Returns port number if CDP is enabled, null otherwise
 */
async function detectCDPPort(): Promise<number | null> {
  const defaultPort = 9222;
  const portsToCheck = [defaultPort, 9223, 9224]; // Check multiple ports

  for (const port of portsToCheck) {
    if (await isCDPEnabled(port)) {
      return port;
    }
  }

  return null;
}

/**
 * Check if CDP is enabled on a specific port
 *
 * @param port - Port number to check (default: 9222)
 * @returns true if CDP is available, false otherwise
 */
export async function isCDPEnabled(port = 9222): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    console.error(`[browser] Checking CDP on port ${port}...`);
    const response = await fetch(`http://localhost:${port}/json/version`, {
      signal: controller.signal,
    });

    console.error(`[browser] CDP response.ok:`, response.ok);

    if (response.ok) {
      const data = (await response.json()) as { webSocketDebuggerUrl?: string };
      const enabled = Boolean(data.webSocketDebuggerUrl);
      console.error(`[browser] CDP enabled:`, enabled, 'data:', data);
      return enabled;
    }

    console.error(`[browser] CDP response not OK`);
    return false;
  } catch (error) {
    // Connection refused or timeout - CDP not enabled
    console.error(`[browser] CDP error:`, String(error));
    logger.debug(`CDP not available on port ${port}`, {
      error: String(error),
    });
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

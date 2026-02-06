/**
 * Windows UI Automation - Access accessibility tree
 * Auto-detects window type and applies the right strategy:
 * - Native: standard UI Automation on window
 * - WebView2/Electron: search for Document elements globally
 * - MSAA fallback: use IAccessible for Electron apps when UIA fails
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
// tmpdir import removed - not used
import { ensureNvdaForElectron } from './nvda.js';
// Dynamic import to bust ESM cache (detectBrowser)
// import { detectBrowser } from './browser.js';
import { connectCDP, disconnectCDP, getActiveTab } from './cdp-client.js';
import { getInteractiveElements } from './cdp-elements.js';
import { restartBrowserWithCDP } from './browser-restart.js';
import { detectUnityGame, isUnityBridgeAvailable, getUnityElements } from './unity-bridge.js';

// Cache-busting dynamic import for detectBrowser
async function getDetectBrowser() {
  const timestamp = Date.now();
  const module = await import(`./browser.js?t=${timestamp}`);
  return module.detectBrowser;
}

const execAsync = promisify(exec);

// Load window types config
const __dirname = dirname(fileURLToPath(import.meta.url));
let windowTypesConfig: WindowTypesConfig | null = null;

interface WindowTypeEntry {
  strategy: 'native' | 'webview2' | 'electron' | 'uwp' | 'browser' | 'unity';
  note?: string;
  examples?: string[];
  browserType?: string;
}

interface WindowTypesConfig {
  strategies: Record<string, { description: string; method: string; scope: string }>;
  windowClasses: Record<string, WindowTypeEntry>;
  processNames: Record<string, WindowTypeEntry>;
  fallback: { strategy: string };
}

function loadWindowTypesConfig(): WindowTypesConfig {
  if (windowTypesConfig) return windowTypesConfig;

  try {
    const configPath = join(__dirname, '..', 'config', 'window-types.json');
    windowTypesConfig = JSON.parse(readFileSync(configPath, 'utf-8'));
    return windowTypesConfig!;
  } catch {
    // Default fallback config
    return {
      strategies: {},
      windowClasses: {},
      processNames: {},
      fallback: { strategy: 'native' }
    };
  }
}

export interface UIElement {
  type: string;
  name: string;
  description?: string;
  automationId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  isEnabled: boolean;
  value?: string;
}

export interface UITree {
  window: string;
  windowClass: string;
  strategy: 'native' | 'webview2' | 'electron' | 'uwp' | 'browser' | 'unity';
  elements: UIElement[];
  /** Interactive UI elements only (buttons, inputs, etc.) - send this to AI */
  ui: UIElement[];
  /** Text content elements - kept for reference but not sent to AI */
  content: UIElement[];
  timestamp: string;
  /** Window bounds (x, y, width, height) on screen - only for browser strategy */
  windowBounds?: { x: number; y: number; width: number; height: number };
  /** Whether Unity Bridge TCP connection was used (vs native fallback) */
  unityBridgeActive?: boolean;
}

/**
 * Detect which strategy to use based on window class name
 */
function detectStrategy(windowClass: string, processName?: string): 'native' | 'webview2' | 'electron' | 'uwp' | 'browser' | 'unity' {
  const config = loadWindowTypesConfig();

  // Check Unity first (highest priority after browser)
  if (detectUnityGame(processName || '', windowClass)) {
    return 'unity';
  }

  // Check process name first (more reliable for browsers)
  if (processName) {
    const procLower = processName.toLowerCase();
    if (config.processNames[procLower]) {
      return config.processNames[procLower].strategy;
    }
  }

  // Check exact match
  if (config.windowClasses[windowClass]) {
    return config.windowClasses[windowClass].strategy;
  }

  // Check partial matches
  for (const [className, entry] of Object.entries(config.windowClasses)) {
    if (windowClass.includes(className) || className.includes(windowClass)) {
      return entry.strategy;
    }
  }

  // Heuristics for common patterns
  if (windowClass.includes('Chrome_WidgetWin')) return 'electron';
  if (windowClass.includes('Chrome Legacy Window')) return 'electron'; // CEF apps like Battle.net
  if (windowClass.includes('CefBrowserWindow')) return 'electron'; // Generic CEF
  if (windowClass.includes('WebView')) return 'webview2';
  if (windowClass.includes('WinUI')) return 'webview2';
  if (windowClass.includes('ApplicationFrame')) return 'uwp';

  return 'native';
}

/**
 * Get UI elements - auto-detects strategy based on window type
 * When no window is focused (desktop active), returns taskbar elements
 */
export async function getUIElements(windowTitle?: string): Promise<UITree> {
  // Debug log to absolute path
  const logFile = '/tmp/oscribe-uielem.log';
  try {
    appendFileSync(logFile, `[${new Date().toISOString()}] getUIElements called: platform=${process.platform}, windowTitle=${windowTitle}\n`);
  } catch {
    // Ignore log errors
  }

  // Platform-specific implementation
  if (process.platform === 'darwin') {
    try {
      appendFileSync(logFile, `[${new Date().toISOString()}] Calling getUIElementsMacOS\n`);
    } catch {
      // Ignore log errors
    }
    return getUIElementsMacOS(windowTitle);
  } else if (process.platform === 'win32') {
    return getUIElementsWindows(windowTitle);
  } else {
    throw new Error(`UI Automation is not yet supported on ${process.platform}`);
  }
}

/**
 * Windows implementation of UI Automation
 */
async function getUIElementsWindows(windowTitle?: string): Promise<UITree> {
  // Step 1: Get window info and detect strategy
  const windowInfo = await getWindowInfo(windowTitle);

  // Step 2: Check if desktop is active (no window focused)
  // Desktop classes: Progman, WorkerW, or empty
  const isDesktopActive = !windowInfo.name ||
    windowInfo.className === 'Progman' ||
    windowInfo.className === 'WorkerW' ||
    windowInfo.className === '';

  if (isDesktopActive && !windowTitle) {
    // Desktop active - capture taskbar elements
    const taskbarElements = await findTaskbarElements();

    const ui = taskbarElements.filter((el) => el.type !== 'Text' && el.type !== 'Image');
    const content = taskbarElements.filter((el) => el.type === 'Text');

    return {
      window: 'Windows Taskbar',
      windowClass: 'Shell_TrayWnd',
      strategy: 'native',
      elements: taskbarElements,
      ui,
      content,
      timestamp: new Date().toISOString(),
    };
  }

  const strategy = detectStrategy(windowInfo.className, windowInfo.processName);

  // Step 3: Apply the right strategy
  let elements: UIElement[] = [];
  let unityBridgeActive = false;

  if (strategy === 'unity') {
    // Unity strategy: try Unity Bridge first, fallback to native
    try {
      if (await isUnityBridgeAvailable()) {
        const { elements: unityElements } = await getUnityElements();
        elements = unityElements;
        unityBridgeActive = true;
      } else {
        console.warn('[uiautomation] Unity Bridge not available, fallback native');
        elements = await findNativeElements(windowInfo.name);
      }
    } catch (error) {
      console.warn('[uiautomation] Unity Bridge failed, falling back to native', { error: String(error) });
      elements = await findNativeElements(windowInfo.name);
    }
  } else if (strategy === 'browser') {
    // Browser strategy: try CDP first, fallback to native
    try {
      const { elements: browserElements } = await getBrowserElementsViaCDP(windowInfo.className, windowInfo.name);
      elements = browserElements;
    } catch (error) {
      console.warn('[uiautomation] CDP failed, falling back to native', { error: String(error) });
      elements = await findNativeElements(windowInfo.name);
    }
  } else if (strategy === 'webview2' || strategy === 'electron') {
    // For Electron/CEF apps, ensure NVDA is running FIRST
    // Chromium only exposes its accessibility tree when a screen reader is detected
    if (strategy === 'electron') {
      await ensureNvdaForElectron(true);
    }

    // Search for Document elements globally
    elements = await findDocumentElements(windowInfo.name);

    // Fallback to native if no document found
    if (elements.length === 0) {
      elements = await findNativeElements(windowInfo.name);
    }

    // MSAA fallback for Electron apps when UIA still finds too few elements
    if (strategy === 'electron' && elements.length < 10) {
      const msaaElements = await findMsaaElements(windowInfo.name);
      if (msaaElements.length > elements.length) {
        elements = msaaElements;
      }
    }
  } else {
    // Native strategy
    elements = await findNativeElements(windowInfo.name);

    // Heuristic: if few elements found, try document search
    if (elements.length < 10) {
      const docElements = await findDocumentElements(windowInfo.name);
      if (docElements.length > elements.length) {
        elements = docElements;
      }
    }
  }

  // Separate UI elements from content
  // Exclude Text (content) and Image (not interactive)
  const ui = elements.filter((el) => el.type !== 'Text' && el.type !== 'Image');
  const content = elements.filter((el) => el.type === 'Text');

  const result: UITree = {
    window: windowInfo.name,
    windowClass: windowInfo.className,
    strategy,
    elements,
    ui,
    content,
    timestamp: new Date().toISOString(),
  };
  if (unityBridgeActive) result.unityBridgeActive = true;
  return result;
}

/**
 * Get basic window info (name, class, process name)
 */
async function getWindowInfo(windowTitle?: string): Promise<{ name: string; className: string; processName: string }> {
  const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'windows', 'get-window-info.ps1');
  const windowFilter = windowTitle ? `"${windowTitle}"` : '""';

  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -WindowFilter ${windowFilter}`,
      { timeout: 5000 }
    );

    return JSON.parse(stdout.trim());
  } catch {
    return { name: '', className: '', processName: '' };
  }
}

/**
 * Find elements using native UI Automation on window
 */
async function findNativeElements(windowName: string): Promise<UIElement[]> {
  const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'windows', 'find-native-elements.ps1');

  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -WindowName "${windowName.replace(/"/g, '\\"')}"`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 10000 }
    );

    const result = stdout.trim();
    if (!result || result === '[]') return [];

    const parsed = JSON.parse(result);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/**
 * Find Document elements (for WebView2/Electron/WinUI apps)
 * Simple approach: find Documents with RootWebArea that overlap with window
 */
async function findDocumentElements(windowTitle: string): Promise<UIElement[]> {
  const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'windows', 'find-document-elements.ps1');

  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -WindowTitle "${windowTitle.replace(/"/g, '\\"')}"`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 15000 }
    );

    const result = stdout.trim();
    if (!result || result === '[]') return [];

    const parsed = JSON.parse(result);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

/**
 * Taskbar configuration on Windows
 */
export interface TaskbarConfig {
  position: 'bottom' | 'top' | 'left' | 'right';
  autoHide: boolean;
  visible: boolean;
}

/**
 * Get Windows taskbar configuration (position, auto-hide, visibility)
 */
export async function getTaskbarConfig(): Promise<TaskbarConfig> {
  if (process.platform !== 'win32') {
    return { position: 'bottom', autoHide: false, visible: true };
  }

  const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'windows', 'get-taskbar-config.ps1');

  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
      { timeout: 5000 }
    );

    return JSON.parse(stdout.trim()) as TaskbarConfig;
  } catch {
    return { position: 'bottom', autoHide: false, visible: true };
  }
}

/**
 * Find Windows system UI elements (taskbar, desktop, start menu, system tray, etc.)
 * Captures all OS-level UI elements, not just application windows
 */
export async function findSystemUIElements(): Promise<UIElement[]> {
  const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'windows', 'find-system-ui-elements.ps1');

  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}"`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 15000 }
    );

    const result = stdout.trim();
    if (!result || result === '[]') return [];

    const parsed = JSON.parse(result);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return [];
  }
}

// Keep backward compatibility
async function findTaskbarElements(): Promise<UIElement[]> {
  return findSystemUIElements();
}

/**
 * Get browser elements via Chrome DevTools Protocol (CDP)
 * Works for Chromium browsers: Chrome, Edge, Brave, Arc, Opera
 */
/**
 * Get window bounds for the active browser window (macOS)
 */
async function getBrowserWindowBounds(appName: string): Promise<{ x: number; y: number; width: number; height: number } | null> {
  if (process.platform !== 'darwin') {
    return null; // Only macOS supported for now
  }

  try {
    const script = `
      tell application "System Events"
        set frontApp to first application process whose name is "${appName.replace(/"/g, '\\"')}"
        tell frontApp
          tell front window
            set windowBounds to position
            set windowSize to size
            set x to item 1 of windowBounds as text
            set y to item 2 of windowBounds as text
            set w to item 1 of windowSize as text
            set h to item 2 of windowSize as text
            return x & "|" & y & "|" & w & "|" & h
          end tell
        end tell
      end tell
    `;

    const { stdout } = await execAsync(`osascript -e '${script.replace(/'/g, "'\\''")}'`);
    const parts = stdout.trim().split('|').map(Number);

    if (parts.length === 4 && parts.every((n) => !isNaN(n))) {
      return {
        x: parts[0]!,
        y: parts[1]!,
        width: parts[2]!,
        height: parts[3]!,
      };
    }

    return null;
  } catch {
    return null;
  }
}

async function getBrowserElementsViaCDP(windowClass: string, windowTitle: string): Promise<{ elements: UIElement[]; chromeUIOffset: number }> {
  const event = {
    action: 'cdp_get_elements',
    windowClass,
    windowTitle,
    timestamp: new Date().toISOString(),
    duration_ms: 0,
    success: false,
    elementsFound: 0,
  };

  const start = Date.now();

  try {
    // 1. Detect browser (with cache-busting)
    // On macOS, windowClass is generic (AXWindow), so we need to get the app name
    const { getActiveWindow } = await import('./windows.js');
    const activeWindow = await getActiveWindow();
    const appName = activeWindow?.app ?? '';

    const detectBrowser = await getDetectBrowser();
    let browserInfo = await detectBrowser(windowClass, appName);
    if (!browserInfo) {
      throw new Error('Browser not detected');
    }

    if (!browserInfo.isDebuggingEnabled) {
      // Auto-restart browser with CDP enabled - OScribe magic!
      console.log('[uiautomation] CDP not enabled, auto-restarting browser...');

      const restartResult = await restartBrowserWithCDP(9222, appName);

      if (!restartResult.success || !restartResult.cdpEnabled) {
        throw new Error(`Failed to restart browser with CDP: ${restartResult.error || 'unknown error'}`);
      }

      console.log(`[uiautomation] Browser restarted with CDP (${restartResult.tabsRestored}/${restartResult.tabsSaved} tabs restored)`);

      // Re-detect browser after restart
      browserInfo = await detectBrowser(windowClass, appName);
      if (!browserInfo?.isDebuggingEnabled) {
        throw new Error('CDP still not enabled after browser restart');
      }
    }

    // 2. Connect to CDP
    const cdp = await connectCDP({
      port: browserInfo.debugPort || 9222,
      host: 'localhost',
    });

    // 3. Get active tab
    const tab = await getActiveTab(cdp);
    if (!tab) {
      await disconnectCDP(cdp);
      throw new Error('No active tab found');
    }

    // 4. Get Chrome UI offset (exact toolbar height)
    const { getChromeUIOffset } = await import('./cdp-elements.js');
    const chromeUIOffset = await getChromeUIOffset(cdp);

    // 5. Extract interactive elements
    const elements = await getInteractiveElements(cdp);

    // 6. Cleanup
    await disconnectCDP(cdp);

    event.duration_ms = Date.now() - start;
    event.success = true;
    event.elementsFound = elements.length;
    console.log('[uiautomation]', event);

    return { elements, chromeUIOffset };
  } catch (error) {
    event.duration_ms = Date.now() - start;
    console.warn('[uiautomation]', event);
    throw error;
  }
}

/**
 * Find elements using MSAA (IAccessible) - fallback for Electron apps
 * Uses MsaaReader.exe to access the accessibility tree via COM
 *
 * Why MSAA works when UIA doesn't:
 * - Electron/Chromium uses IAccessible2 for accessibility on Windows
 * - Windows can convert IAccessible2 → UIA but it doesn't always work
 * - MSAA (IAccessible) is the legacy API and Chromium supports it better
 *
 * IMPORTANT: NVDA must be running for this to work!
 * - Chromium only exposes its accessibility tree when a screen reader is detected
 * - NVDA uses DLL injection to register IAccessible2 proxy from INSIDE the process
 * - The ensureNvdaForElectron() function handles this automatically
 *
 * Results on Electron apps:
 * - 70-110+ elements detected (vs 3 with UIA)
 * - Without NVDA: only 3-7 elements
 *
 * macOS: Uses ax-reader (Swift binary) via AXUIElement API
 * - Source: scripts/macos/ax-reader.swift
 * - Compile: swiftc scripts/macos/ax-reader.swift -o bin/ax-reader
 * - Output same JSON format as MsaaReader.exe on Windows
 * - Check if Electron exposes accessibility better on macOS
 */
async function findMsaaElements(windowTitle: string): Promise<UIElement[]> {
  // TODO: Add macOS support with ax-reader binary
  if (process.platform !== 'win32') {
    return []; // macOS/Linux not yet supported
  }

  // Path to MsaaReader.exe (bundled with oscribe)
  // From dist/src/core/ go up 3 levels to reach oscribe/, then into bin/
  const msaaReaderPath = join(__dirname, '..', '..', '..', 'bin', 'MsaaReader.exe');

  // Check if MsaaReader.exe exists
  if (!existsSync(msaaReaderPath)) {
    return [];
  }

  try {
    // Escape the window title for command line
    const safeTitle = windowTitle.replace(/"/g, '\\"');

    const { stdout } = await execAsync(`"${msaaReaderPath}" "${safeTitle}"`, {
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const result = JSON.parse(stdout.trim());

    if (result.error) {
      return [];
    }

    // Map MSAA elements to UIElement format
    return (result.elements || []).map(
      (el: { type: string; name: string; x: number; y: number; width: number; height: number }) => ({
        type: el.type,
        name: el.name || '',
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        isEnabled: true,
      })
    );
  } catch {
    return [];
  }
}

/**
 * macOS implementation using AXUIElement via ax-reader binary
 */
async function getUIElementsMacOS(windowTitle?: string): Promise<UITree> {
  // Path to ax-reader binary (bundled with oscribe)
  const axReaderPath = join(__dirname, '..', '..', '..', 'bin', 'ax-reader');

  // Check if ax-reader exists
  if (!existsSync(axReaderPath)) {
    throw new Error('ax-reader binary not found. Run: swiftc scripts/macos/ax-reader.swift -o bin/ax-reader');
  }

  // Get active window if no title specified
  // Always get app name for Electron detection
  const { getActiveWindow } = await import('./windows.js');
  const activeWindow = await getActiveWindow();

  const targetWindow = windowTitle || (activeWindow?.title ?? '');
  const appName = activeWindow?.app ?? '';

  // Debug log to file
  const logFile = '/tmp/oscribe-uielem.log';
  try {
    appendFileSync(logFile, `[${new Date().toISOString()}] macOS activeWindow: ${JSON.stringify({ title: activeWindow?.title, app: activeWindow?.app, appName })}\n`);
  } catch {
    // Ignore log errors
  }

  if (!targetWindow) {
    // No window focused - return empty for now
    // TODO: Return Dock elements on macOS?
    return {
      window: 'Desktop',
      windowClass: 'Desktop',
      strategy: 'native',
      elements: [],
      ui: [],
      content: [],
      timestamp: new Date().toISOString(),
    };
  }

  // Check if this is a Chromium browser and CDP is available (with cache-busting)
  const detectBrowser = await getDetectBrowser();
  try {
    appendFileSync(logFile, `[${new Date().toISOString()}] Calling detectBrowser with appName: ${appName}\n`);
  } catch {
    // Ignore log errors
  }
  const browserInfo = await detectBrowser('', appName);
  try {
    appendFileSync(logFile, `[${new Date().toISOString()}] Browser detected: ${JSON.stringify(browserInfo)}\n`);
  } catch {
    // Ignore log errors
  }

  try {
    appendFileSync(logFile, `[${new Date().toISOString()}] Checking CDP condition: browserInfo=${!!browserInfo}, isDebuggingEnabled=${browserInfo?.isDebuggingEnabled}\n`);
  } catch {
    // Ignore log errors
  }

  // Auto-restart browser if CDP not enabled (OScribe magic!)
  if (browserInfo && !browserInfo.isDebuggingEnabled) {
    try {
      appendFileSync(logFile, `[${new Date().toISOString()}] CDP not enabled, auto-restarting browser...\n`);
      console.log('[uiautomation] CDP not enabled, auto-restarting browser...');

      const restartResult = await restartBrowserWithCDP(9222, appName);

      if (restartResult.success && restartResult.cdpEnabled) {
        appendFileSync(logFile, `[${new Date().toISOString()}] Browser restarted successfully (${restartResult.tabsRestored}/${restartResult.tabsSaved} tabs)\n`);
        console.log(`[uiautomation] Browser restarted with CDP (${restartResult.tabsRestored}/${restartResult.tabsSaved} tabs restored)`);

        // Re-detect browser after restart
        const newBrowserInfo = await detectBrowser('', appName);
        if (newBrowserInfo?.isDebuggingEnabled) {
          // Update browserInfo reference for the CDP block below
          Object.assign(browserInfo, newBrowserInfo);
        }
      } else {
        appendFileSync(logFile, `[${new Date().toISOString()}] Browser restart failed: ${restartResult.error}\n`);
      }
    } catch (err) {
      appendFileSync(logFile, `[${new Date().toISOString()}] Browser restart error: ${err}\n`);
    }
  }

  if (browserInfo?.isDebuggingEnabled) {
    try {
      appendFileSync(logFile, `[${new Date().toISOString()}] ✓ ENTERING CDP BLOCK - Calling getBrowserElementsViaCDP...\n`);
      const { elements: browserElements, chromeUIOffset } = await getBrowserElementsViaCDP('', targetWindow);
      appendFileSync(logFile, `[${new Date().toISOString()}] CDP returned ${browserElements.length} elements, Chrome UI offset: ${chromeUIOffset}px\n`);

      // Get window bounds for coordinate conversion
      const windowBounds = await getBrowserWindowBounds(appName);
      if (windowBounds) {
        appendFileSync(logFile, `[${new Date().toISOString()}] Window bounds: ${JSON.stringify(windowBounds)}\n`);

        // Convert CDP coordinates to screen coordinates
        // CDP coordinates are relative to the viewport, so we add:
        // - window X/Y position
        // - Chrome UI height (for Y only)
        const offsetX = windowBounds.x;
        const offsetY = windowBounds.y + chromeUIOffset;

        appendFileSync(logFile, `[${new Date().toISOString()}] Applying offset: x+${offsetX}, y+${offsetY} (window.y=${windowBounds.y} + chromeUI=${chromeUIOffset})\n`);

        browserElements.forEach((el) => {
          el.x += offsetX;
          el.y += offsetY;
        });
      }

      // Separate UI elements from content
      const ui = browserElements.filter((el) => el.type !== 'Text' && el.type !== 'Image');
      const content = browserElements.filter((el) => el.type === 'Text');

      appendFileSync(logFile, `[${new Date().toISOString()}] Returning strategy=browser\n`);
      const result: UITree = {
        window: targetWindow,
        windowClass: 'Browser',
        strategy: 'browser',
        elements: browserElements,
        ui,
        content,
        timestamp: new Date().toISOString(),
      };
      if (windowBounds) {
        result.windowBounds = windowBounds;
      }
      return result;
    } catch (error) {
      appendFileSync(logFile, `[${new Date().toISOString()}] CDP FAILED: ${error instanceof Error ? error.message : String(error)}\n`);
      appendFileSync(logFile, `[${new Date().toISOString()}] Stack: ${error instanceof Error ? error.stack : 'N/A'}\n`);
      console.warn('[uiautomation] CDP failed on macOS, falling back to native', { error: String(error) });
      // Fall through to native UI Automation
    }
  }

  try {
    // Escape window title for shell
    const safeTitle = targetWindow.replace(/"/g, '\\"');

    const { stdout } = await execAsync(`"${axReaderPath}" "${safeTitle}"`, {
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const output = stdout.trim();

    // Check for empty output (permissions issue)
    if (!output) {
      throw new Error(
        `ax-reader returned no output. This usually means:\n` +
        `1. Accessibility permissions are not granted\n` +
        `2. The window "${targetWindow}" was not found\n\n` +
        `To grant permissions:\n` +
        `System Settings > Privacy & Security > Accessibility > Enable for your terminal/IDE`
      );
    }

    const result = JSON.parse(output) as {
      window: string;
      elements: Array<{
        type: string;
        name: string;
        description?: string;
        x: number;
        y: number;
        width: number;
        height: number;
        isEnabled: boolean;
      }>;
      error?: string;
    };

    if (result.error) {
      throw new Error(result.error);
    }

    // Map to UIElement format
    const elements: UIElement[] = result.elements.map((el) => {
      const element: UIElement = {
        type: el.type,
        name: el.name || '',
        x: el.x,
        y: el.y,
        width: el.width,
        height: el.height,
        isEnabled: el.isEnabled,
      };
      if (el.description) {
        element.description = el.description;
      }
      return element;
    });

    // Detect app type using the cross-platform strategy from window-types.json
    const detectedStrategy = detectStrategy('', appName.toLowerCase());
    const isElectronApp = detectedStrategy === 'electron';

    if (elements.length < 10 && isElectronApp) {
      // Try AXManualAccessibility first (preferred - no audio, faster)
      const { enableElectronAccessibility } = await import('./axmanual.js');

      const axEnabled = await enableElectronAccessibility(appName);

      if (axEnabled) {
        // Wait a moment for Electron to apply the accessibility change
        await new Promise((resolve) => setTimeout(resolve, 500));

        // Retry element detection
        const { stdout: retryStdout } = await execAsync(`"${axReaderPath}" "${safeTitle}"`, {
          timeout: 15000,
          maxBuffer: 10 * 1024 * 1024,
        });

        const retryResult = JSON.parse(retryStdout.trim()) as typeof result;

        if (retryResult.elements.length > elements.length) {
          // AXManualAccessibility helped - use new results
            const newElements: UIElement[] = retryResult.elements.map((el) => ({
              type: el.type,
              name: el.name || '',
              x: el.x,
              y: el.y,
              width: el.width,
              height: el.height,
              isEnabled: el.isEnabled,
              ...(el.description ? { description: el.description } : {}),
            }));

            const ui = newElements.filter((el) => el.type !== 'Text' && el.type !== 'Image');
            const content = newElements.filter((el) => el.type === 'Text');

          return {
            window: result.window,
            windowClass: 'AXWindow',
            strategy: detectedStrategy,
            elements: newElements,
            ui,
            content,
            timestamp: new Date().toISOString(),
          };
        }
      }
    }

    // Separate UI elements from content
    const ui = elements.filter((el) => el.type !== 'Text' && el.type !== 'Image');
    const content = elements.filter((el) => el.type === 'Text');

    return {
      window: result.window,
      windowClass: 'AXWindow', // macOS uses AX roles
      strategy: 'native',
      elements,
      ui,
      content,
      timestamp: new Date().toISOString(),
    };
  } catch {
    // Return empty on error
    return {
      window: targetWindow,
      windowClass: 'Unknown',
      strategy: 'native',
      elements: [],
      ui: [],
      content: [],
      timestamp: new Date().toISOString(),
    };
  }
}

/**
 * Find a specific element by name or type
 */
export async function findElement(
  target: string,
  windowTitle?: string
): Promise<UIElement | null> {
  const tree = await getUIElements(windowTitle);
  const targetLower = target.toLowerCase();

  // Search by name first
  let found = tree.elements.find(
    (el) => el.name?.toLowerCase().includes(targetLower)
  );

  // Then by automationId
  found ??= tree.elements.find(
    (el) => el.automationId?.toLowerCase().includes(targetLower)
  );

  // Then by description
  found ??= tree.elements.find(
    (el) => el.description?.toLowerCase().includes(targetLower)
  );

  return found ?? null;
}

/**
 * Get element at cursor position
 */
export async function getElementAtPoint(x: number, y: number): Promise<UIElement | null> {
  if (process.platform === 'darwin') {
    return getElementAtPointMacOS(x, y);
  } else if (process.platform === 'win32') {
    return getElementAtPointWindows(x, y);
  } else {
    throw new Error(`UI Automation is not yet supported on ${process.platform}`);
  }
}

/**
 * macOS: Get element at point (not yet implemented - returns null)
 * TODO: Implement using AXUIElementCopyElementAtPosition
 */
async function getElementAtPointMacOS(_x: number, _y: number): Promise<UIElement | null> {
  // For now, return null - this would require extending ax-reader
  // or using a separate Swift snippet
  return null;
}

/**
 * Windows: Get element at cursor position
 */
async function getElementAtPointWindows(x: number, y: number): Promise<UIElement | null> {
  const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'windows', 'get-element-at-point.ps1');

  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -X ${x} -Y ${y}`,
      { timeout: 5000 }
    );

    const result = stdout.trim();
    if (result === 'null') return null;

    return JSON.parse(result) as UIElement;
  } catch {
    return null;
  }
}

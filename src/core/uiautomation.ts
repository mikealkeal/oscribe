/**
 * Windows UI Automation - Access accessibility tree
 * Auto-detects window type and applies the right strategy:
 * - Native: standard UI Automation on window
 * - WebView2/Electron: search for Document elements globally
 * - MSAA fallback: use IAccessible for Electron apps when UIA fails
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureNvdaForElectron } from './nvda.js';

const execAsync = promisify(exec);

// Load window types config
const __dirname = dirname(fileURLToPath(import.meta.url));
let windowTypesConfig: WindowTypesConfig | null = null;

interface WindowTypeEntry {
  strategy: 'native' | 'webview2' | 'electron' | 'uwp';
  note?: string;
  examples?: string[];
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
  strategy: 'native' | 'webview2' | 'electron' | 'uwp';
  elements: UIElement[];
  /** Interactive UI elements only (buttons, inputs, etc.) - send this to AI */
  ui: UIElement[];
  /** Text content elements - kept for reference but not sent to AI */
  content: UIElement[];
  timestamp: string;
}

/**
 * Detect which strategy to use based on window class name
 */
function detectStrategy(windowClass: string): 'native' | 'webview2' | 'electron' | 'uwp' {
  const config = loadWindowTypesConfig();

  // Check exact match first
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
  // Platform-specific implementation
  if (process.platform === 'darwin') {
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

  const strategy = detectStrategy(windowInfo.className);

  // Step 3: Apply the right strategy
  let elements: UIElement[] = [];

  if (strategy === 'webview2' || strategy === 'electron') {
    // Search for Document elements globally
    elements = await findDocumentElements(windowInfo.name);

    // Fallback to native if no document found
    if (elements.length === 0) {
      elements = await findNativeElements(windowInfo.name);
    }

    // MSAA fallback for Electron apps when UIA finds too few elements
    // Electron apps often don't expose their accessibility tree via UIA
    // NVDA must be running to trigger Chromium's accessibility tree
    if (elements.length < 10) {
      // Ensure NVDA is running for Electron accessibility
      await ensureNvdaForElectron();

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

  return {
    window: windowInfo.name,
    windowClass: windowInfo.className,
    strategy,
    elements,
    ui,
    content,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get basic window info (name, class)
 */
async function getWindowInfo(windowTitle?: string): Promise<{ name: string; className: string }> {
  const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'windows', 'get-window-info.ps1');
  const windowFilter = windowTitle ? `"${windowTitle}"` : '""';

  try {
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -WindowFilter ${windowFilter}`,
      { timeout: 5000 }
    );

    return JSON.parse(stdout.trim());
  } catch {
    return { name: '', className: '' };
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

  let targetWindow = windowTitle || (activeWindow?.title ?? '');
  const appName = activeWindow?.app ?? '';

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

    // If few elements detected and this looks like an Electron app, try with VoiceOver
    const isElectronApp = appName.toLowerCase().includes('electron') ||
                          appName.toLowerCase().includes('code') ||
                          appName.toLowerCase().includes('slack') ||
                          appName.toLowerCase().includes('discord');

    if (elements.length < 10 && isElectronApp) {
      // Import VoiceOver helper
      const { ensureVoiceOverForElectron, isVoiceOverRunning } = await import('./voiceover.js');

      // Check if VoiceOver is already running
      const voiceOverWasRunning = await isVoiceOverRunning();

      if (!voiceOverWasRunning) {
        // Start VoiceOver in silent mode
        const started = await ensureVoiceOverForElectron();

        if (started) {
          // Wait for Electron to detect VoiceOver and expose accessibility tree
          await new Promise((resolve) => setTimeout(resolve, 2000));

          // Retry element detection
          const { stdout: retryStdout } = await execAsync(`"${axReaderPath}" "${safeTitle}"`, {
            timeout: 15000,
            maxBuffer: 10 * 1024 * 1024,
          });

          const retryResult = JSON.parse(retryStdout.trim()) as typeof result;

          if (retryResult.elements.length > elements.length) {
            // VoiceOver helped - use new results
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
              strategy: 'native',
              elements: newElements,
              ui,
              content,
              timestamp: new Date().toISOString(),
            };
          }
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
  } catch (error) {
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

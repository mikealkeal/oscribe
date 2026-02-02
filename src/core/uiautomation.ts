/**
 * Windows UI Automation - Access accessibility tree
 * Auto-detects window type and applies the right strategy:
 * - Native: standard UI Automation on window
 * - WebView2/Electron: search for Document elements globally
 * - MSAA fallback: use IAccessible for Electron apps when UIA fails
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
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
  const windowFilter = windowTitle ? `"${windowTitle}"` : '""';

  const psScript = `
Add-Type -AssemblyName UIAutomationClient;
$root = [System.Windows.Automation.AutomationElement]::RootElement;
$windowFilter = ${windowFilter};
if ($windowFilter -ne "") {
    # Search for Window type elements in descendants (includes modal dialogs)
    $windowCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Window
    );
    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $windowCondition);
    $window = $null;
    foreach ($w in $windows) {
        if ($w.Current.Name -like "*$windowFilter*") { $window = $w; break; }
    }
} else {
    $window = [System.Windows.Automation.AutomationElement]::FocusedElement;
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker;
    while ($window -and $window.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window -and $window -ne $root) {
        $window = $walker.GetParent($window);
    }
}
if (-not $window -or $window -eq $root) { Write-Output '{"name":"","className":""}'; exit; }
@{ name = $window.Current.Name; className = $window.Current.ClassName } | ConvertTo-Json -Compress
`;

  const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
  const { stdout } = await execAsync(
    `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
    { timeout: 5000 }
  );

  return JSON.parse(stdout.trim());
}

/**
 * Find elements using native UI Automation on window
 */
async function findNativeElements(windowName: string): Promise<UIElement[]> {
  const psScript = `
Add-Type -AssemblyName UIAutomationClient;
$root = [System.Windows.Automation.AutomationElement]::RootElement;
# Search for Window type elements in descendants (includes modal dialogs like Save As)
$windowCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window
);
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $windowCondition);
$window = $null;
foreach ($w in $windows) {
    if ($w.Current.Name -like "*${windowName.replace(/"/g, '`"').replace(/[*?[\]]/g, '`$&')}*") { $window = $w; break; }
}
if (-not $window) { Write-Output '[]'; exit; }

$elements = @();
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsEnabledProperty, $true);
$allElements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition);

foreach ($el in $allElements) {
    try {
        $rect = $el.Current.BoundingRectangle;
        if ($rect.Width -gt 0 -and $rect.Height -gt 0 -and -not [System.Double]::IsInfinity($rect.X)) {
            $name = $el.Current.Name;
            if ($name -match '[a-zA-Z0-9\\p{L}]') {
                $elements += @{
                    type = $el.Current.ControlType.ProgrammaticName -replace "ControlType.", "";
                    name = $name;
                    description = $el.Current.HelpText;
                    automationId = $el.Current.AutomationId;
                    x = [int]$rect.X; y = [int]$rect.Y;
                    width = [int]$rect.Width; height = [int]$rect.Height;
                    isEnabled = $el.Current.IsEnabled
                }
            }
        }
    } catch {}
}
$elements | ConvertTo-Json -Depth 2 -Compress
`;

  try {
    const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
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
  // Escape special regex chars for PowerShell -match
  const safeTitle = windowTitle.replace(/[.*+?^${}()|[\]\\]/g, '.');

  const psScript = `
Add-Type -AssemblyName UIAutomationClient
$root = [System.Windows.Automation.AutomationElement]::RootElement

# Find window by name
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$window = $null
foreach ($w in $windows) {
    if ($w.Current.Name -match '${safeTitle.substring(0, 30)}') { $window = $w; break }
}

if (-not $window) { Write-Output '[]'; exit }

$winRect = $window.Current.BoundingRectangle
$winL = $winRect.X; $winT = $winRect.Y
$winR = $winRect.X + $winRect.Width; $winB = $winRect.Y + $winRect.Height

$docCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Document)
$allDocs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $docCond)

$elements = @()

# Find the Document with HIGHEST overlap ratio (best match for this window)
$bestDoc = $null
$bestRatio = 0
foreach ($doc in $allDocs) {
    $r = $doc.Current.BoundingRectangle
    if ([System.Double]::IsInfinity($r.X) -or $r.Width -lt 100) { continue }
    $oL = [Math]::Max($r.X, $winL); $oT = [Math]::Max($r.Y, $winT)
    $oR = [Math]::Min($r.X + $r.Width, $winR); $oB = [Math]::Min($r.Y + $r.Height, $winB)
    $oArea = [Math]::Max(0, $oR - $oL) * [Math]::Max(0, $oB - $oT)
    $docArea = $r.Width * $r.Height
    $ratio = if ($docArea -gt 0) { $oArea / $docArea } else { 0 }
    if ($ratio -gt $bestRatio) { $bestRatio = $ratio; $bestDoc = $doc }
}

# Only use the best Document if it has >50% overlap
$docs = @()
if ($bestDoc -and $bestRatio -gt 0.5) { $docs = @($bestDoc) }
if ($docs.Count -eq 0) { $docs = @($window) }

foreach ($doc in $docs) {
    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker;

    function Walk-Element {
        param($el, $depth)
        if ($depth -gt 25) { return }

        try {
            $rect = $el.Current.BoundingRectangle;
            $name = $el.Current.Name;
            $type = $el.Current.ControlType.ProgrammaticName -replace "ControlType.", "";
            $help = $el.Current.HelpText;
            $autoId = $el.Current.AutomationId;

            # Include interactive elements
            if ($name -or $autoId -or $type -eq "Button" -or $type -eq "TabItem" -or $type -eq "Slider" -or $type -eq "CheckBox" -or $type -eq "Edit" -or $type -eq "ComboBox" -or $type -eq "ListItem" -or $type -eq "MenuItem") {
                if ($rect.Width -gt 0 -and $rect.Height -gt 0 -and -not [System.Double]::IsInfinity($rect.X)) {
                    $script:elements += @{
                        type = $type;
                        name = if ($name) { $name } else { $help };
                        description = $help;
                        automationId = $autoId;
                        x = [int]$rect.X; y = [int]$rect.Y;
                        width = [int]$rect.Width; height = [int]$rect.Height;
                        isEnabled = $el.Current.IsEnabled
                    }
                }
            }

            $child = $walker.GetFirstChild($el);
            while ($child) {
                Walk-Element $child ($depth + 1);
                $child = $walker.GetNextSibling($child);
            }
        } catch {}
    }

    Walk-Element $doc 0;
}

if ($elements.Count -eq 0) { Write-Output '[]'; exit; }
$elements | ConvertTo-Json -Depth 2 -Compress
`;

  const scriptPath = join(tmpdir(), `oscribe-ui-${Date.now()}.ps1`);
  try {
    writeFileSync(scriptPath, psScript, 'utf8');
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
  } finally {
    try { unlinkSync(scriptPath); } catch { /* ignore */ }
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

  const psScript = `
Add-Type -AssemblyName UIAutomationClient;
$root = [System.Windows.Automation.AutomationElement]::RootElement;

# Find taskbar
$condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, "Shell_TrayWnd"
);
$taskbar = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition);

$result = @{ position = "bottom"; autoHide = $false; visible = $true }

if ($taskbar) {
    $rect = $taskbar.Current.BoundingRectangle;

    # Check visibility (if Y > screen height, it's hidden)
    Add-Type -AssemblyName System.Windows.Forms
    $screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds

    # Determine position based on taskbar bounds
    if ($rect.Width -gt $rect.Height) {
        # Horizontal taskbar (top or bottom)
        if ($rect.Y -lt $screen.Height / 2) {
            $result.position = "top"
        } else {
            $result.position = "bottom"
        }
    } else {
        # Vertical taskbar (left or right)
        if ($rect.X -lt $screen.Width / 2) {
            $result.position = "left"
        } else {
            $result.position = "right"
        }
    }

    # Check if auto-hide is enabled (taskbar mostly off-screen)
    if ($result.position -eq "bottom" -and $rect.Y -ge $screen.Height - 5) {
        $result.autoHide = $true
        $result.visible = $false
    } elseif ($result.position -eq "top" -and $rect.Y -le -$rect.Height + 5) {
        $result.autoHide = $true
        $result.visible = $false
    } elseif ($result.position -eq "left" -and $rect.X -le -$rect.Width + 5) {
        $result.autoHide = $true
        $result.visible = $false
    } elseif ($result.position -eq "right" -and $rect.X -ge $screen.Width - 5) {
        $result.autoHide = $true
        $result.visible = $false
    }
}

$result | ConvertTo-Json -Compress
`;

  try {
    const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
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
  const psScript = `
Add-Type -AssemblyName UIAutomationClient;
$root = [System.Windows.Automation.AutomationElement]::RootElement;
$elements = @();
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker;

# System window classes to capture
$systemClasses = @(
    "Shell_TrayWnd",      # Taskbar
    "Shell_SecondaryTrayWnd", # Secondary taskbar (multi-monitor)
    "Progman",            # Desktop
    "WorkerW",            # Desktop worker
    "Windows.UI.Core.CoreWindow", # Start menu, Action center, etc.
    "NotifyIconOverflowWindow", # System tray overflow
    "TopLevelWindowForOverflowXamlIsland" # Windows 11 widgets
)

function Walk-Element {
    param($el, $depth, $source)
    if ($depth -gt 20) { return }

    try {
        $rect = $el.Current.BoundingRectangle;
        $name = $el.Current.Name;
        $type = $el.Current.ControlType.ProgrammaticName -replace "ControlType.", "";
        $autoId = $el.Current.AutomationId;
        $className = $el.Current.ClassName;

        if ($rect.Width -gt 0 -and $rect.Height -gt 0 -and -not [System.Double]::IsInfinity($rect.X)) {
            # Include interactive elements
            if ($name -or $type -eq "Button" -or $type -eq "MenuItem" -or $type -eq "ListItem" -or $autoId) {
                $script:elements += @{
                    type = $type;
                    name = if ($name) { $name } else { $autoId };
                    description = $el.Current.HelpText;
                    automationId = $autoId;
                    source = $source;
                    x = [int]$rect.X; y = [int]$rect.Y;
                    width = [int]$rect.Width; height = [int]$rect.Height;
                    isEnabled = $el.Current.IsEnabled
                }
            }
        }

        $child = $walker.GetFirstChild($el);
        while ($child) {
            Walk-Element $child ($depth + 1) $source;
            $child = $walker.GetNextSibling($child);
        }
    } catch {}
}

# Find and walk all system windows
foreach ($className in $systemClasses) {
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty, $className
    );
    $systemWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition);
    foreach ($sysWin in $systemWindows) {
        Walk-Element $sysWin 0 $className;
    }
}

if ($elements.Count -eq 0) { Write-Output '[]'; exit; }
$elements | ConvertTo-Json -Depth 2 -Compress
`;

  try {
    const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
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
 * TODO macOS: Create ax-reader (Swift binary) using AXUIElement API
 * - macOS uses AXUIElement for accessibility, not MSAA
 * - Need to compile: swiftc ax-reader.swift -o ax-reader
 * - Output same JSON format as MsaaReader.exe
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
    throw new Error('ax-reader binary not found. Run: swiftc bin/ax-reader.swift -o bin/ax-reader');
  }

  // Get active window if no title specified
  let targetWindow = windowTitle;
  if (!targetWindow) {
    const { getActiveWindow } = await import('./windows.js');
    const activeWindow = await getActiveWindow();
    targetWindow = activeWindow?.title ?? '';
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

  const psScript = `
Add-Type -AssemblyName UIAutomationClient;
Add-Type -AssemblyName PresentationCore;
$point = New-Object System.Windows.Point(${x}, ${y});
$el = [System.Windows.Automation.AutomationElement]::FromPoint($point);
if ($el) {
    $rect = $el.Current.BoundingRectangle;
    @{
        type = $el.Current.ControlType.ProgrammaticName -replace "ControlType.", "";
        name = $el.Current.Name;
        description = $el.Current.HelpText;
        automationId = $el.Current.AutomationId;
        x = [int]$rect.X; y = [int]$rect.Y;
        width = [int]$rect.Width; height = [int]$rect.Height;
        isEnabled = $el.Current.IsEnabled
    } | ConvertTo-Json -Compress
} else { Write-Output 'null' }
`;

  try {
    const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
      { timeout: 5000 }
    );

    const result = stdout.trim();
    if (result === 'null') return null;

    return JSON.parse(result) as UIElement;
  } catch {
    return null;
  }
}

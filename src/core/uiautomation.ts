/**
 * Windows UI Automation - Access accessibility tree
 * Auto-detects window type and applies the right strategy:
 * - Native: standard UI Automation on window
 * - WebView2/Electron: search for Document elements globally
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

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
 */
export async function getUIElements(windowTitle?: string): Promise<UITree> {
  if (process.platform !== 'win32') {
    throw new Error('UI Automation is only available on Windows');
  }

  // Step 1: Get window info and detect strategy
  const windowInfo = await getWindowInfo(windowTitle);
  const strategy = detectStrategy(windowInfo.className);

  // Step 2: Apply the right strategy
  let elements: UIElement[] = [];

  if (strategy === 'webview2' || strategy === 'electron') {
    // Search for Document elements globally
    elements = await findDocumentElements(windowInfo.name);

    // Fallback to native if no document found
    if (elements.length === 0) {
      elements = await findNativeElements(windowInfo.name);
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

  const scriptPath = join(tmpdir(), `osbot-ui-${Date.now()}.ps1`);
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
  if (process.platform !== 'win32') {
    throw new Error('UI Automation is only available on Windows');
  }

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

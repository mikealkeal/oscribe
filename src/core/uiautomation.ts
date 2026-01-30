/**
 * Windows UI Automation - Access accessibility tree
 * Provides structured UI element data like a "DOM" for desktop apps
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface UIElement {
  type: string;
  name: string;
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
  elements: UIElement[];
  timestamp: string;
}

/**
 * Get UI elements from the focused window using Windows UI Automation
 */
export async function getUIElements(windowTitle?: string): Promise<UITree> {
  if (process.platform !== 'win32') {
    throw new Error('UI Automation is only available on Windows');
  }

  // PowerShell script to query UI Automation
  const windowFilter = windowTitle ? `"${windowTitle}"` : '""';
  const psScript = `
Add-Type -AssemblyName UIAutomationClient;
Add-Type -AssemblyName UIAutomationTypes;
$root = [System.Windows.Automation.AutomationElement]::RootElement;
$windowFilter = ${windowFilter};
if ($windowFilter -ne "") {
    $condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "*$windowFilter*");
    $window = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition);
} else {
    $window = [System.Windows.Automation.AutomationElement]::FocusedElement;
    while ($window.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window -and $window -ne $root) {
        $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker;
        $window = $walker.GetParent($window);
    }
}
if (-not $window -or $window -eq $root) { Write-Output '{"error":"No window found"}'; exit; }
$windowName = $window.Current.Name;
$elements = @();
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::IsEnabledProperty, $true);
$allElements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition);
foreach ($el in $allElements) {
    try {
        $rect = $el.Current.BoundingRectangle;
        if ($rect.Width -gt 0 -and $rect.Height -gt 0 -and -not [System.Double]::IsInfinity($rect.X)) {
            $type = $el.Current.ControlType.ProgrammaticName -replace "ControlType.", "";
            if ($type -in @("Button", "Edit", "Text", "ComboBox", "CheckBox", "RadioButton", "ListItem", "MenuItem", "TabItem", "Hyperlink", "Image")) {
                $value = "";
                try { $valuePattern = $el.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern); if ($valuePattern) { $value = $valuePattern.Current.Value } } catch {}
                $elements += @{ type = $type; name = $el.Current.Name; automationId = $el.Current.AutomationId; x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height; isEnabled = $el.Current.IsEnabled; value = $value }
            }
        }
    } catch {}
}
$elements = $elements | Select-Object -First 100;
$result = @{ window = $windowName; elements = $elements; timestamp = (Get-Date -Format "o") };
$result | ConvertTo-Json -Depth 3 -Compress
`;

  try {
    // Encode script as Base64 for reliable execution
    const encodedScript = Buffer.from(psScript, 'utf16le').toString('base64');
    const { stdout } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encodedScript}`,
      { maxBuffer: 10 * 1024 * 1024, timeout: 10000 }
    );

    const result = JSON.parse(stdout.trim());

    if (result.error) {
      throw new Error(result.error);
    }

    return result as UITree;
  } catch (error) {
    throw new Error(`UI Automation failed: ${error instanceof Error ? error.message : String(error)}`);
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
    (el) => el.name.toLowerCase().includes(targetLower)
  );

  // Then by automationId
  if (!found) {
    found = tree.elements.find(
      (el) => el.automationId?.toLowerCase().includes(targetLower)
    );
  }

  return found || null;
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
$point = New-Object System.Windows.Point(${x}, ${y});
$el = [System.Windows.Automation.AutomationElement]::FromPoint($point);
if ($el) {
    $rect = $el.Current.BoundingRectangle;
    $result = @{ type = $el.Current.ControlType.ProgrammaticName -replace "ControlType.", ""; name = $el.Current.Name; automationId = $el.Current.AutomationId; x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height; isEnabled = $el.Current.IsEnabled };
    $result | ConvertTo-Json -Compress
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

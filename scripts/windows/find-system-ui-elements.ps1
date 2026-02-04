# Find-SystemUIElements.ps1
# Find Windows system UI elements (taskbar, desktop, start menu, system tray, etc.)
# Captures all OS-level UI elements, not just application windows
# Usage: powershell -File find-system-ui-elements.ps1
#
# Output: JSON array of UI elements

Add-Type -AssemblyName UIAutomationClient

$root = [System.Windows.Automation.AutomationElement]::RootElement
$elements = @()
$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

# System window classes to capture
$systemClasses = @(
    "Shell_TrayWnd",              # Taskbar
    "Shell_SecondaryTrayWnd",     # Secondary taskbar (multi-monitor)
    "Progman",                    # Desktop
    "WorkerW",                    # Desktop worker
    "Windows.UI.Core.CoreWindow", # Start menu, Action center, etc.
    "NotifyIconOverflowWindow",   # System tray overflow
    "TopLevelWindowForOverflowXamlIsland" # Windows 11 widgets
)

function Walk-Element {
    param($el, $depth, $source)
    if ($depth -gt 20) { return }

    try {
        $rect = $el.Current.BoundingRectangle
        $name = $el.Current.Name
        $type = $el.Current.ControlType.ProgrammaticName -replace "ControlType.", ""
        $autoId = $el.Current.AutomationId
        $className = $el.Current.ClassName

        if ($rect.Width -gt 0 -and $rect.Height -gt 0 -and -not [System.Double]::IsInfinity($rect.X)) {
            # Include interactive elements
            if ($name -or $type -eq "Button" -or $type -eq "MenuItem" -or $type -eq "ListItem" -or $autoId) {
                $script:elements += @{
                    type = $type
                    name = if ($name) { $name } else { $autoId }
                    description = $el.Current.HelpText
                    automationId = $autoId
                    source = $source
                    x = [int]$rect.X
                    y = [int]$rect.Y
                    width = [int]$rect.Width
                    height = [int]$rect.Height
                    isEnabled = $el.Current.IsEnabled
                }
            }
        }

        $child = $walker.GetFirstChild($el)
        while ($child) {
            Walk-Element $child ($depth + 1) $source
            $child = $walker.GetNextSibling($child)
        }
    } catch {}
}

# Find and walk all system windows
foreach ($className in $systemClasses) {
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ClassNameProperty,
        $className
    )
    $systemWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)

    foreach ($sysWin in $systemWindows) {
        Walk-Element $sysWin 0 $className
    }
}

if ($elements.Count -eq 0) {
    Write-Output '[]'
    exit
}

$elements | ConvertTo-Json -Depth 2 -Compress

# Find-NativeElements.ps1
# Find UI elements using native UI Automation on a window
# Usage: powershell -File find-native-elements.ps1 -WindowName "Title"
#
# Output: JSON array of UI elements

param(
    [Parameter(Mandatory=$true)]
    [string]$WindowName
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient

$root = [System.Windows.Automation.AutomationElement]::RootElement

# Search for Window type elements in descendants (includes modal dialogs like Save As)
$windowCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Window
)
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $windowCondition)
$window = $null

foreach ($w in $windows) {
    if ($w.Current.Name -like "*$WindowName*") {
        $window = $w
        break
    }
}

if (-not $window) {
    Write-Output '[]'
    exit
}

$elements = @()
$condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::IsEnabledProperty,
    $true
)
$allElements = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)

foreach ($el in $allElements) {
    try {
        $rect = $el.Current.BoundingRectangle
        if ($rect.Width -gt 0 -and $rect.Height -gt 0 -and -not [System.Double]::IsInfinity($rect.X)) {
            $name = $el.Current.Name
            $helpText = $el.Current.HelpText
            $autoId = $el.Current.AutomationId

            # Include element if it has a name, tooltip (HelpText), or automationId
            $hasName = $name -match '[a-zA-Z0-9\p{L}]'
            $hasHelp = $helpText -and ($helpText -match '[a-zA-Z0-9\p{L}]')
            $hasAutoId = $autoId -and ($autoId -match '[a-zA-Z0-9]')

            if ($hasName -or $hasHelp -or $hasAutoId) {
                # Use HelpText as name fallback when Name is empty
                $displayName = if ($hasName) { $name } elseif ($hasHelp) { $helpText } else { $autoId }
                $elements += @{
                    type = $el.Current.ControlType.ProgrammaticName -replace "ControlType.", ""
                    name = $displayName
                    description = $helpText
                    automationId = $autoId
                    x = [int]$rect.X
                    y = [int]$rect.Y
                    width = [int]$rect.Width
                    height = [int]$rect.Height
                    isEnabled = $el.Current.IsEnabled
                }
            }
        }
    } catch {}
}

# Also scan modal dialogs — they are separate top-level windows owned by the same process.
# Captures confirmation dialogs, file pickers, etc. that are NOT descendants of the main window.
$mainProcessId = $window.Current.ProcessId
$allRootWindows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $windowCondition)
foreach ($dialogWin in $allRootWindows) {
    try {
        if ($dialogWin.Current.ProcessId -eq $mainProcessId -and
            $dialogWin.Current.Name -ne $window.Current.Name -and
            $dialogWin.Current.BoundingRectangle.Width -gt 0 -and
            -not [System.Double]::IsInfinity($dialogWin.Current.BoundingRectangle.X)) {
            $dialogElements = $dialogWin.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
            foreach ($el in $dialogElements) {
                try {
                    $rect = $el.Current.BoundingRectangle
                    if ($rect.Width -gt 0 -and $rect.Height -gt 0 -and -not [System.Double]::IsInfinity($rect.X)) {
                        $name = $el.Current.Name
                        $helpText = $el.Current.HelpText
                        $autoId = $el.Current.AutomationId
                        $hasName = $name -match '[a-zA-Z0-9\p{L}]'
                        $hasHelp = $helpText -and ($helpText -match '[a-zA-Z0-9\p{L}]')
                        $hasAutoId = $autoId -and ($autoId -match '[a-zA-Z0-9]')
                        if ($hasName -or $hasHelp -or $hasAutoId) {
                            $displayName = if ($hasName) { $name } elseif ($hasHelp) { $helpText } else { $autoId }
                            $elements += @{
                                type = $el.Current.ControlType.ProgrammaticName -replace "ControlType.", ""
                                name = $displayName
                                description = $helpText
                                automationId = $autoId
                                x = [int]$rect.X
                                y = [int]$rect.Y
                                width = [int]$rect.Width
                                height = [int]$rect.Height
                                isEnabled = $el.Current.IsEnabled
                            }
                        }
                    }
                } catch {}
            }
        }
    } catch {}
}

# Also scan popup menus — they are separate top-level windows (#32768),
# NOT descendants of the main window. Captures dropdown menus, context menus, etc.
$menuCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Menu
)
$popupMenus = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $menuCondition)
foreach ($menu in $popupMenus) {
    try {
        $menuRect = $menu.Current.BoundingRectangle
        if ($menuRect.Width -gt 0 -and $menuRect.Height -gt 0 -and -not [System.Double]::IsInfinity($menuRect.X)) {
            $menuItems = $menu.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
            foreach ($el in $menuItems) {
                try {
                    $rect = $el.Current.BoundingRectangle
                    if ($rect.Width -gt 0 -and $rect.Height -gt 0 -and -not [System.Double]::IsInfinity($rect.X)) {
                        $name = $el.Current.Name
                        $helpText = $el.Current.HelpText
                        $autoId = $el.Current.AutomationId
                        $hasName = $name -match '[a-zA-Z0-9\p{L}]'
                        $hasHelp = $helpText -and ($helpText -match '[a-zA-Z0-9\p{L}]')
                        $hasAutoId = $autoId -and ($autoId -match '[a-zA-Z0-9]')
                        if ($hasName -or $hasHelp -or $hasAutoId) {
                            $displayName = if ($hasName) { $name } elseif ($hasHelp) { $helpText } else { $autoId }
                            $elements += @{
                                type = $el.Current.ControlType.ProgrammaticName -replace "ControlType.", ""
                                name = $displayName
                                description = $helpText
                                automationId = $autoId
                                x = [int]$rect.X
                                y = [int]$rect.Y
                                width = [int]$rect.Width
                                height = [int]$rect.Height
                                isEnabled = $el.Current.IsEnabled
                            }
                        }
                    }
                } catch {}
            }
        }
    } catch {}
}

$elements | ConvertTo-Json -Depth 2 -Compress

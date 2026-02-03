# Find-NativeElements.ps1
# Find UI elements using native UI Automation on a window
# Usage: powershell -File find-native-elements.ps1 -WindowName "Title"
#
# Output: JSON array of UI elements

param(
    [Parameter(Mandatory=$true)]
    [string]$WindowName
)

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
            if ($name -match '[a-zA-Z0-9\p{L}]') {
                $elements += @{
                    type = $el.Current.ControlType.ProgrammaticName -replace "ControlType.", ""
                    name = $name
                    description = $el.Current.HelpText
                    automationId = $el.Current.AutomationId
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

$elements | ConvertTo-Json -Depth 2 -Compress

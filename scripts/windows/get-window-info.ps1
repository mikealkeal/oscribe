# Get-WindowInfo.ps1
# Returns window name and class for the focused or specified window
# Usage: powershell -File get-window-info.ps1 [-WindowFilter "Title"]
#
# Output: JSON { "name": "...", "className": "...", "processName": "...", "bounds": { ... } }

param(
    [string]$WindowFilter = ""
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient

$root = [System.Windows.Automation.AutomationElement]::RootElement

if ($WindowFilter -ne "") {
    # Search for Window type elements in descendants (includes modal dialogs)
    $windowCondition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::Window
    )
    $windows = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $windowCondition)
    $window = $null
    foreach ($w in $windows) {
        if ($w.Current.Name -like "*$WindowFilter*") {
            $window = $w
            break
        }
    }
} else {
    $window = [System.Windows.Automation.AutomationElement]::FocusedElement
    $walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
    while ($window -and $window.Current.ControlType -ne [System.Windows.Automation.ControlType]::Window -and $window -ne $root) {
        $window = $walker.GetParent($window)
    }
}

if (-not $window -or $window -eq $root) {
    Write-Output '{"name":"","className":"","processName":"","bounds":null}'
    exit
}

# Get process name from ProcessId
$processName = ""
try {
    $procId = $window.Current.ProcessId
    if ($procId -gt 0) {
        $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($proc) {
            $processName = $proc.ProcessName.ToLower()
        }
    }
} catch {}

# Get window bounding rectangle
$bounds = $null
try {
    $rect = $window.Current.BoundingRectangle
    if ($rect.Width -gt 0 -and $rect.Height -gt 0 -and -not [System.Double]::IsInfinity($rect.X)) {
        $bounds = @{
            x = [int]$rect.X
            y = [int]$rect.Y
            width = [int]$rect.Width
            height = [int]$rect.Height
        }
    }
} catch {}

@{
    name = $window.Current.Name
    className = $window.Current.ClassName
    processName = $processName
    bounds = $bounds
} | ConvertTo-Json -Compress -Depth 3

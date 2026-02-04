# Get-WindowInfo.ps1
# Returns window name and class for the focused or specified window
# Usage: powershell -File get-window-info.ps1 [-WindowFilter "Title"]
#
# Output: JSON { "name": "...", "className": "..." }

param(
    [string]$WindowFilter = ""
)

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
    Write-Output '{"name":"","className":""}'
    exit
}

@{
    name = $window.Current.Name
    className = $window.Current.ClassName
} | ConvertTo-Json -Compress

# Get-ElementAtPoint.ps1
# Get UI element at specific screen coordinates
# Usage: powershell -File get-element-at-point.ps1 -X 100 -Y 200
#
# Output: JSON object with element info or 'null' if not found

param(
    [Parameter(Mandatory=$true)]
    [int]$X,

    [Parameter(Mandatory=$true)]
    [int]$Y
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName PresentationCore

$point = New-Object System.Windows.Point($X, $Y)
$el = [System.Windows.Automation.AutomationElement]::FromPoint($point)

if ($el) {
    $rect = $el.Current.BoundingRectangle
    @{
        type = $el.Current.ControlType.ProgrammaticName -replace "ControlType.", ""
        name = $el.Current.Name
        description = $el.Current.HelpText
        automationId = $el.Current.AutomationId
        x = [int]$rect.X
        y = [int]$rect.Y
        width = [int]$rect.Width
        height = [int]$rect.Height
        isEnabled = $el.Current.IsEnabled
    } | ConvertTo-Json -Compress
} else {
    Write-Output 'null'
}

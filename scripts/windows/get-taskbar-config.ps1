# Get-TaskbarConfig.ps1
# Get Windows taskbar configuration (position, auto-hide, visibility)
# Usage: powershell -File get-taskbar-config.ps1
#
# Output: JSON { "position": "bottom", "autoHide": false, "visible": true }

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Add-Type -AssemblyName UIAutomationClient

$root = [System.Windows.Automation.AutomationElement]::RootElement

# Find taskbar
$condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty,
    "Shell_TrayWnd"
)
$taskbar = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $condition)

$result = @{
    position = "bottom"
    autoHide = $false
    visible = $true
}

if ($taskbar) {
    $rect = $taskbar.Current.BoundingRectangle

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

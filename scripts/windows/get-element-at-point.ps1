# Get-ElementAtPoint.ps1
# Get UI element at specific screen coordinates
# Usage: powershell -File get-element-at-point.ps1 -X 100 -Y 200
#
# Output: JSON object with element info or 'null' if not found
#
# Strategy:
# 1. UIA AutomationElement.FromPoint() — works for most apps
# 2. If result is generic (Window/Pane), walk UIA children for a better match
# 3. MSAA fallback via AccessibleObjectFromPoint — catches toolbar buttons
#    in native apps (wxWidgets, MFC) that UIA misses

param(
    [Parameter(Mandatory=$true)]
    [int]$X,

    [Parameter(Mandatory=$true)]
    [int]$Y
)

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName PresentationCore

# MSAA P/Invoke
Add-Type @"
using System;
using System.Runtime.InteropServices;

public class OScribeMsaa {
    [DllImport("oleacc.dll")]
    public static extern int AccessibleObjectFromPoint(
        POINT pt,
        [MarshalAs(UnmanagedType.Interface)] out object ppacc,
        out object pvarChild);

    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
        public POINT(int x, int y) { X = x; Y = y; }
    }
}
"@

$point = New-Object System.Windows.Point($X, $Y)
$el = [System.Windows.Automation.AutomationElement]::FromPoint($point)

if (-not $el) {
    Write-Output 'null'
    exit
}

# Helper: build result hashtable from a UIA element
function Get-ElementInfo($element) {
    $rect = $element.Current.BoundingRectangle
    $name = $element.Current.Name
    $helpText = $element.Current.HelpText
    $displayName = if ($name -and ($name -match '[a-zA-Z0-9\p{L}]')) { $name } elseif ($helpText -and ($helpText -match '[a-zA-Z0-9\p{L}]')) { $helpText } else { $name }
    @{
        type = $element.Current.ControlType.ProgrammaticName -replace "ControlType.", ""
        name = $displayName
        description = $helpText
        automationId = $element.Current.AutomationId
        x = [int]$rect.X
        y = [int]$rect.Y
        width = [int]$rect.Width
        height = [int]$rect.Height
        isEnabled = $element.Current.IsEnabled
    }
}

# Helper: MSAA role code → type name
function Get-MsaaTypeName($role) {
    switch ($role) {
        43 { "Button" }
        44 { "DropDown" }
        56 { "MenuItem" }
        22 { "ToolBar" }
        21 { "Separator" }
        62 { "Grip" }
        9  { "Window" }
        16 { "Pane" }
        default { "Control" }
    }
}

$elType = $el.Current.ControlType.ProgrammaticName -replace "ControlType.", ""
$elName = $el.Current.Name
$elHelp = $el.Current.HelpText

# Check if the UIA element is useful as-is
$hasUsefulName = $elName -and ($elName -match '[a-zA-Z0-9\p{L}]')
$hasUsefulHelp = $elHelp -and ($elHelp -match '[a-zA-Z0-9\p{L}]')
$isGeneric = ($elType -eq "Window" -or $elType -eq "Pane") -and (-not $hasUsefulHelp)

if (-not $isGeneric) {
    # UIA returned something specific enough
    (Get-ElementInfo $el) | ConvertTo-Json -Compress
    exit
}

# ── Fallback 1: Walk UIA children ────────────────────────────────────
$bestChild = $null
$bestArea = [double]::MaxValue

try {
    $condition = [System.Windows.Automation.Condition]::TrueCondition
    $children = $el.FindAll([System.Windows.Automation.TreeScope]::Children, $condition)

    foreach ($child in $children) {
        try {
            $cRect = $child.Current.BoundingRectangle
            if ([System.Double]::IsInfinity($cRect.X) -or $cRect.Width -le 0) { continue }

            if ($X -ge $cRect.X -and $X -le ($cRect.X + $cRect.Width) -and
                $Y -ge $cRect.Y -and $Y -le ($cRect.Y + $cRect.Height)) {

                $cName = $child.Current.Name
                $cHelp = $child.Current.HelpText
                $hasInfo = ($cName -and ($cName -match '[a-zA-Z0-9\p{L}]')) -or ($cHelp -and ($cHelp -match '[a-zA-Z0-9\p{L}]'))

                if ($hasInfo) {
                    $area = $cRect.Width * $cRect.Height
                    if ($area -lt $bestArea) {
                        $bestChild = $child
                        $bestArea = $area
                    }
                }
            }
        } catch {}
    }
} catch {}

if ($bestChild) {
    (Get-ElementInfo $bestChild) | ConvertTo-Json -Compress
    exit
}

# ── Fallback 2: MSAA AccessibleObjectFromPoint ──────────────────────
# Catches toolbar buttons in native apps (wxWidgets, MFC, etc.)
try {
    $msaaPoint = New-Object OScribeMsaa+POINT($X, $Y)
    $msaaAcc = $null
    $msaaChildId = $null
    $hr = [OScribeMsaa]::AccessibleObjectFromPoint($msaaPoint, [ref]$msaaAcc, [ref]$msaaChildId)

    if ($hr -eq 0 -and $msaaAcc) {
        $accType = $msaaAcc.GetType()
        $msaaName = $null; try { $msaaName = $accType.InvokeMember("accName", [System.Reflection.BindingFlags]::GetProperty, $null, $msaaAcc, @($msaaChildId)) } catch {}
        $msaaRole = $null; try { $msaaRole = $accType.InvokeMember("accRole", [System.Reflection.BindingFlags]::GetProperty, $null, $msaaAcc, @($msaaChildId)) } catch {}
        $msaaDesc = $null; try { $msaaDesc = $accType.InvokeMember("accDescription", [System.Reflection.BindingFlags]::GetProperty, $null, $msaaAcc, @($msaaChildId)) } catch {}
        $msaaHelp = $null; try { $msaaHelp = $accType.InvokeMember("accHelp", [System.Reflection.BindingFlags]::GetProperty, $null, $msaaAcc, @($msaaChildId)) } catch {}

        $msaaHasName = $msaaName -and ($msaaName -match '[a-zA-Z0-9\p{L}]')
        $msaaHasDesc = $msaaDesc -and ($msaaDesc -match '[a-zA-Z0-9\p{L}]')
        $msaaHasHelp = $msaaHelp -and ($msaaHelp -match '[a-zA-Z0-9\p{L}]')

        # Only use MSAA result if it has useful info and isn't a generic container
        $msaaTypeName = Get-MsaaTypeName $msaaRole
        $msaaIsGeneric = ($msaaTypeName -eq "Window" -or $msaaTypeName -eq "Pane" -or $msaaTypeName -eq "ToolBar")

        if ((-not $msaaIsGeneric) -and ($msaaHasName -or $msaaHasDesc -or $msaaHasHelp)) {
            $displayName = if ($msaaHasName) { $msaaName } elseif ($msaaHasDesc) { $msaaDesc } elseif ($msaaHasHelp) { $msaaHelp } else { "" }
            $description = if ($msaaHasDesc) { $msaaDesc } elseif ($msaaHasHelp) { $msaaHelp } else { "" }

            @{
                type = $msaaTypeName
                name = $displayName
                description = $description
                automationId = ""
                x = [int]$el.Current.BoundingRectangle.X
                y = [int]$el.Current.BoundingRectangle.Y
                width = [int]$el.Current.BoundingRectangle.Width
                height = [int]$el.Current.BoundingRectangle.Height
                isEnabled = $el.Current.IsEnabled
            } | ConvertTo-Json -Compress
            exit
        }
    }
} catch {}

# ── Default: return UIA element as-is ────────────────────────────────
(Get-ElementInfo $el) | ConvertTo-Json -Compress

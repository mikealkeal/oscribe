# Find-DocumentElements.ps1
# Find Document elements (for WebView2/Electron/WinUI apps)
# Finds Documents with RootWebArea that overlap with window
# Usage: powershell -File find-document-elements.ps1 -WindowTitle "Title"
#
# Output: JSON array of UI elements

param(
    [Parameter(Mandatory=$true)]
    [string]$WindowTitle
)

Add-Type -AssemblyName UIAutomationClient

$root = [System.Windows.Automation.AutomationElement]::RootElement

# Find window by name (use first 30 chars for matching)
$safeTitle = $WindowTitle.Substring(0, [Math]::Min(30, $WindowTitle.Length))
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, [System.Windows.Automation.Condition]::TrueCondition)
$window = $null

foreach ($w in $windows) {
    if ($w.Current.Name -match [regex]::Escape($safeTitle)) {
        $window = $w
        break
    }
}

if (-not $window) {
    Write-Output '[]'
    exit
}

$winRect = $window.Current.BoundingRectangle
$winL = $winRect.X
$winT = $winRect.Y
$winR = $winRect.X + $winRect.Width
$winB = $winRect.Y + $winRect.Height

$docCond = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Document
)
$allDocs = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $docCond)

$elements = @()

# Find the Document with HIGHEST overlap ratio (best match for this window)
$bestDoc = $null
$bestRatio = 0

foreach ($doc in $allDocs) {
    $r = $doc.Current.BoundingRectangle
    if ([System.Double]::IsInfinity($r.X) -or $r.Width -lt 100) { continue }

    $oL = [Math]::Max($r.X, $winL)
    $oT = [Math]::Max($r.Y, $winT)
    $oR = [Math]::Min($r.X + $r.Width, $winR)
    $oB = [Math]::Min($r.Y + $r.Height, $winB)
    $oArea = [Math]::Max(0, $oR - $oL) * [Math]::Max(0, $oB - $oT)
    $docArea = $r.Width * $r.Height
    $ratio = if ($docArea -gt 0) { $oArea / $docArea } else { 0 }

    if ($ratio -gt $bestRatio) {
        $bestRatio = $ratio
        $bestDoc = $doc
    }
}

# Only use the best Document if it has >50% overlap
$docs = @()
if ($bestDoc -and $bestRatio -gt 0.5) {
    $docs = @($bestDoc)
}
if ($docs.Count -eq 0) {
    $docs = @($window)
}

$walker = [System.Windows.Automation.TreeWalker]::RawViewWalker

function Walk-Element {
    param($el, $depth)
    if ($depth -gt 25) { return }

    try {
        $rect = $el.Current.BoundingRectangle
        $name = $el.Current.Name
        $type = $el.Current.ControlType.ProgrammaticName -replace "ControlType.", ""
        $help = $el.Current.HelpText
        $autoId = $el.Current.AutomationId

        # Include interactive elements
        if ($name -or $autoId -or $type -eq "Button" -or $type -eq "TabItem" -or $type -eq "Slider" -or $type -eq "CheckBox" -or $type -eq "Edit" -or $type -eq "ComboBox" -or $type -eq "ListItem" -or $type -eq "MenuItem") {
            if ($rect.Width -gt 0 -and $rect.Height -gt 0 -and -not [System.Double]::IsInfinity($rect.X)) {
                $script:elements += @{
                    type = $type
                    name = if ($name) { $name } else { $help }
                    description = $help
                    automationId = $autoId
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
            Walk-Element $child ($depth + 1)
            $child = $walker.GetNextSibling($child)
        }
    } catch {}
}

foreach ($doc in $docs) {
    Walk-Element $doc 0
}

if ($elements.Count -eq 0) {
    Write-Output '[]'
    exit
}

$elements | ConvertTo-Json -Depth 2 -Compress

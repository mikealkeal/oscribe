# ocr-recognize.ps1
# Run Windows.Media.Ocr on a PNG image file
# Usage: powershell -File ocr-recognize.ps1 -ImagePath "C:\path\to\image.png"
#
# Output: JSON with 2-level hierarchy (lines -> words)
# { "lines": [...], "language": "English" }
# All coordinates match image pixel positions (screen-absolute when input is full-screen)

param(
    [Parameter(Mandatory=$true)]
    [string]$ImagePath
)

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

try {
    # Load WinRT types
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    [void][Windows.Media.Ocr.OcrEngine,Windows.Foundation,ContentType=WindowsRuntime]
    [void][Windows.Graphics.Imaging.BitmapDecoder,Windows.Foundation,ContentType=WindowsRuntime]
    [void][Windows.Storage.StorageFile,Windows.Foundation,ContentType=WindowsRuntime]

    # Async helper for WinRT IAsyncOperation
    $asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
        $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    })[0]

    function Await($WinRtTask, $ResultType) {
        $asTaskT = $asTask.MakeGenericMethod($ResultType)
        $netTask = $asTaskT.Invoke($null, @($WinRtTask))
        $netTask.Wait(-1) | Out-Null
        return $netTask.Result
    }

    # Open image file and decode
    $file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
    $stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    $decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
    $softwareBmp = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])

    # Create OCR engine from user profile languages
    $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()

    if (-not $engine) {
        Write-Output '{"lines":[],"error":"No OCR engine available"}'
        $stream.Dispose()
        exit
    }

    # Run OCR
    $result = Await ($engine.RecognizeAsync($softwareBmp)) ([Windows.Media.Ocr.OcrResult])

    # Build JSON output with 2-level hierarchy
    $ocrLines = @()

    foreach ($line in $result.Lines) {
        # Convert WinRT collection to PowerShell array
        $wordList = @()
        foreach ($w in $line.Words) { $wordList += $w }

        # Calculate line bounding box from all words
        $minX = [double]::MaxValue
        $minY = [double]::MaxValue
        $maxRight = 0
        $maxBottom = 0

        foreach ($w in $wordList) {
            $wx = $w.BoundingRect.X
            $wy = $w.BoundingRect.Y
            $wr = $wx + $w.BoundingRect.Width
            $wb = $wy + $w.BoundingRect.Height
            if ($wx -lt $minX) { $minX = $wx }
            if ($wy -lt $minY) { $minY = $wy }
            if ($wr -gt $maxRight) { $maxRight = $wr }
            if ($wb -gt $maxBottom) { $maxBottom = $wb }
        }

        $lineObj = @{
            text = $line.Text
            bounds = @{
                x = [int]$minX
                y = [int]$minY
                width = [int]($maxRight - $minX)
                height = [int]($maxBottom - $minY)
            }
        }

        # Add words sub-group only if 2+ words
        if ($wordList.Count -gt 1) {
            $words = @()
            foreach ($word in $wordList) {
                $words += @{
                    text = $word.Text
                    bounds = @{
                        x = [int]$word.BoundingRect.X
                        y = [int]$word.BoundingRect.Y
                        width = [int]$word.BoundingRect.Width
                        height = [int]$word.BoundingRect.Height
                    }
                }
            }
            $lineObj.words = $words
        }

        $ocrLines += $lineObj
    }

    @{
        lines = $ocrLines
        language = $engine.RecognizerLanguage.DisplayName
    } | ConvertTo-Json -Depth 5 -Compress

    # Cleanup
    $stream.Dispose()

} catch {
    # Fail gracefully - return empty result so screenshot still works
    $errMsg = $_.Exception.Message -replace '"','\"' -replace "`r`n",' ' -replace "`n",' '
    Write-Output ('{"lines":[],"error":"' + $errMsg + '"}')
}

/**
 * OScribe Vision Grid - Grid-based screenshot system for precise visual localization
 *
 * Creates screenshots with a 20×20 grid overlay using gaps between cells.
 * The gaps form the grid lines, keeping the image content intact.
 * Numbers on all 4 borders allow AI models to specify coordinates precisely.
 *
 * @module core/vision-grid
 * @platform Windows (uses PowerShell + System.Drawing)
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, unlink, mkdtemp, writeFile, rmdir } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';

const execAsync = promisify(exec);

// ============================================================================
// Error Classes
// ============================================================================

/**
 * Error thrown when vision grid operations fail
 */
export class VisionGridError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'VisionGridError';
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * Error thrown when platform is not supported
 */
export class PlatformNotSupportedError extends VisionGridError {
  constructor(currentPlatform: string) {
    super(
      `Vision grid requires Windows (PowerShell + System.Drawing). Current platform: ${currentPlatform}`,
      'PLATFORM_NOT_SUPPORTED',
      { platform: currentPlatform }
    );
    this.name = 'PlatformNotSupportedError';
  }
}

// ============================================================================
// Types & Interfaces
// ============================================================================

/** Default configuration values */
const DEFAULTS = {
  gridSize: 26,
  gapSize: 2,
  rulerSize: 20,  // Reduced - only top/left rulers now
  screen: 0,
  maxDimension: 1800,  // Max width OR height (keeps aspect ratio) - under 2000px API limit
  jpegQuality: 95,  // JPEG quality (50-100) - 95 for readable grid numbers
} as const;

/** Validation limits */
const LIMITS = {
  minGridSize: 5,
  maxGridSize: 50,
  minGapSize: 1,
  maxGapSize: 20,
  minRulerSize: 15,
  maxRulerSize: 50,
  minMaxDimension: 720,
  maxMaxDimension: 1950,  // Stay under 2000px API limit for multi-image requests
  minJpegQuality: 50,
  maxJpegQuality: 100,
} as const;

export interface VisionGridOptions {
  /** Screen index to capture (default: 0) */
  screen?: number;
  /** Grid size - number of cells per axis (default: 20, range: 5-50) */
  gridSize?: number;
  /** Gap size between cells in pixels (default: 4, range: 1-20) */
  gapSize?: number;
  /** Ruler size for numbers on borders in pixels (default: 25, range: 15-50) */
  rulerSize?: number;
  /** Max dimension (width OR height) - keeps aspect ratio (default: 1800, range: 720-1950) */
  maxDimension?: number;
  /** JPEG quality for compression (default: 85, range: 50-100) */
  jpegQuality?: number;
}

export interface VisionGridResult {
  /** PNG image buffer */
  buffer: Buffer;
  /** Base64 encoded PNG */
  base64: string;
  /** Final image width (with gaps and rulers) */
  width: number;
  /** Final image height (with gaps and rulers) */
  height: number;
  /** Original screen width */
  screenWidth: number;
  /** Original screen height */
  screenHeight: number;
  /** Grid size used */
  gridSize: number;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Validate options and return validated values with defaults
 */
function validateOptions(options: VisionGridOptions): Required<VisionGridOptions> {
  const {
    screen = DEFAULTS.screen,
    gridSize = DEFAULTS.gridSize,
    gapSize = DEFAULTS.gapSize,
    rulerSize = DEFAULTS.rulerSize,
    maxDimension = DEFAULTS.maxDimension,
    jpegQuality = DEFAULTS.jpegQuality,
  } = options;

  // Validate screen index
  if (!Number.isInteger(screen) || screen < 0) {
    throw new VisionGridError(
      `Invalid screen index: ${screen}. Must be a non-negative integer.`,
      'INVALID_SCREEN_INDEX',
      { screen }
    );
  }

  // Validate grid size
  if (!Number.isInteger(gridSize) || gridSize < LIMITS.minGridSize || gridSize > LIMITS.maxGridSize) {
    throw new VisionGridError(
      `Invalid grid size: ${gridSize}. Must be between ${LIMITS.minGridSize} and ${LIMITS.maxGridSize}.`,
      'INVALID_GRID_SIZE',
      { gridSize, min: LIMITS.minGridSize, max: LIMITS.maxGridSize }
    );
  }

  // Validate gap size
  if (!Number.isInteger(gapSize) || gapSize < LIMITS.minGapSize || gapSize > LIMITS.maxGapSize) {
    throw new VisionGridError(
      `Invalid gap size: ${gapSize}. Must be between ${LIMITS.minGapSize} and ${LIMITS.maxGapSize}.`,
      'INVALID_GAP_SIZE',
      { gapSize, min: LIMITS.minGapSize, max: LIMITS.maxGapSize }
    );
  }

  // Validate ruler size
  if (!Number.isInteger(rulerSize) || rulerSize < LIMITS.minRulerSize || rulerSize > LIMITS.maxRulerSize) {
    throw new VisionGridError(
      `Invalid ruler size: ${rulerSize}. Must be between ${LIMITS.minRulerSize} and ${LIMITS.maxRulerSize}.`,
      'INVALID_RULER_SIZE',
      { rulerSize, min: LIMITS.minRulerSize, max: LIMITS.maxRulerSize }
    );
  }

  // Validate maxDimension
  if (!Number.isInteger(maxDimension) || maxDimension < LIMITS.minMaxDimension || maxDimension > LIMITS.maxMaxDimension) {
    throw new VisionGridError(
      `Invalid maxDimension: ${maxDimension}. Must be between ${LIMITS.minMaxDimension} and ${LIMITS.maxMaxDimension}.`,
      'INVALID_MAX_DIMENSION',
      { maxDimension, min: LIMITS.minMaxDimension, max: LIMITS.maxMaxDimension }
    );
  }

  // Validate jpegQuality
  if (!Number.isInteger(jpegQuality) || jpegQuality < LIMITS.minJpegQuality || jpegQuality > LIMITS.maxJpegQuality) {
    throw new VisionGridError(
      `Invalid jpegQuality: ${jpegQuality}. Must be between ${LIMITS.minJpegQuality} and ${LIMITS.maxJpegQuality}.`,
      'INVALID_JPEG_QUALITY',
      { jpegQuality, min: LIMITS.minJpegQuality, max: LIMITS.maxJpegQuality }
    );
  }

  return { screen, gridSize, gapSize, rulerSize, maxDimension, jpegQuality };
}

/**
 * Check if current platform supports vision grid
 */
function checkPlatformSupport(): void {
  if (platform() !== 'win32') {
    throw new PlatformNotSupportedError(platform());
  }
}

// ============================================================================
// Main Functions
// ============================================================================

/**
 * Capture screenshot with vision grid overlay
 *
 * The screenshot is divided into a grid of cells with small gaps between them.
 * The gaps visually form grid lines without obscuring the content.
 * Numbers are drawn on all 4 borders for coordinate reference.
 *
 * @throws {PlatformNotSupportedError} If not running on Windows
 * @throws {VisionGridError} If capture fails or options are invalid
 *
 * @example
 * const result = await captureWithVisionGrid({ screen: 0, gridSize: 20 });
 * // AI sees grid, identifies button at cell (12, 8)
 * // Convert to screen coords: gridToScreen(12, 8, result.screenWidth, result.screenHeight)
 */
export async function captureWithVisionGrid(
  options: VisionGridOptions = {}
): Promise<VisionGridResult> {
  // Platform check
  checkPlatformSupport();

  // Validate and apply defaults
  const { screen, gridSize, gapSize, rulerSize, maxDimension, jpegQuality } = validateOptions(options);

  // Create temp files
  const tempDir = await mkdtemp(join(tmpdir(), 'oscribe-vision-'));
  const tempScript = join(tempDir, 'vision.ps1');
  const tempOutput = join(tempDir, 'vision.jpg');  // JPEG for smaller size
  const metadataPath = join(tempDir, 'metadata.txt');

  const psScript = generateVisionGridScript(screen, gridSize, gapSize, rulerSize, maxDimension, jpegQuality, tempOutput, metadataPath);

  try {
    await writeFile(tempScript, psScript, 'utf8');

    // Execute PowerShell script
    const { stderr } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -File "${tempScript}"`,
      { windowsHide: true }
    );

    if (stderr) {
      throw new VisionGridError(
        `PowerShell script produced errors: ${stderr}`,
        'POWERSHELL_ERROR',
        { stderr }
      );
    }

    // Read output image
    const buffer = await readFile(tempOutput);

    // Validate JPEG signature (first 2 bytes: FF D8)
    const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8]);
    if (!buffer.subarray(0, 2).equals(JPEG_SIGNATURE)) {
      throw new VisionGridError(
        'Invalid JPEG output from PowerShell script',
        'INVALID_JPEG_OUTPUT',
        { firstBytes: buffer.subarray(0, 8).toString('hex') }
      );
    }

    // JPEG dimensions are harder to extract, read from metadata instead
    // We'll get them from the metadata file along with screen dimensions

    // Read dimensions from metadata file (screenW,screenH,finalW,finalH)
    const metadata = await readFile(metadataPath, 'utf8');
    const [screenWidth, screenHeight, width, height] = metadata.trim().split(',').map(Number);

    if (!screenWidth || !screenHeight || !width || !height) {
      throw new VisionGridError(
        'Failed to read dimensions from metadata',
        'INVALID_METADATA',
        { metadata }
      );
    }

    return {
      buffer,
      base64: buffer.toString('base64'),
      width,
      height,
      screenWidth,
      screenHeight,
      gridSize,
    };
  } catch (error) {
    // Re-throw VisionGridError as-is
    if (error instanceof VisionGridError) {
      throw error;
    }

    // Wrap other errors
    const message = error instanceof Error ? error.message : String(error);
    throw new VisionGridError(
      `Failed to capture vision grid: ${message}`,
      'CAPTURE_FAILED',
      { originalError: message }
    );
  } finally {
    // Cleanup temp files (best effort, log errors for debugging)
    const cleanup = async (path: string): Promise<void> => {
      try {
        await unlink(path);
      } catch {
        // File may not exist yet if error occurred early
      }
    };

    await Promise.all([
      cleanup(tempScript),
      cleanup(tempOutput),
      cleanup(metadataPath),
    ]);

    try {
      await rmdir(tempDir);
    } catch {
      // Directory may not be empty or may not exist
    }
  }
}

/**
 * Generate PowerShell script for vision grid capture
 * Optimized: resizes to fit maxDimension on both axes (keeps aspect ratio) and saves as JPEG
 */
function generateVisionGridScript(
  screenIndex: number,
  gridSize: number,
  gapSize: number,
  rulerSize: number,
  maxDimension: number,
  jpegQuality: number,
  outputPath: string,
  metadataPath: string
): string {
  const escapedOutputPath = outputPath.replace(/\\/g, '\\\\');
  const escapedMetadataPath = metadataPath.replace(/\\/g, '\\\\');

  return `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# Config
$gridSize = ${gridSize}
$gapSize = ${gapSize}
$rulerSize = ${rulerSize}
$maxDimension = ${maxDimension}
$jpegQuality = ${jpegQuality}
$outputPath = '${escapedOutputPath}'
$metadataPath = '${escapedMetadataPath}'

# Get screen
$allScreens = [System.Windows.Forms.Screen]::AllScreens
$screenIndex = ${screenIndex}
if ($screenIndex -ge $allScreens.Length) { $screenIndex = 0 }
$screen = $allScreens[$screenIndex]
$bounds = $screen.Bounds

# Capture screenshot
$screenshot = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($screenshot)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)

# Calculate resize ratio to fit maxDimension on BOTH width and height (keep aspect ratio)
# Use the smaller ratio to ensure both dimensions stay within limit
$ratioWidth = if ($bounds.Width -gt $maxDimension) { $maxDimension / $bounds.Width } else { 1.0 }
$ratioHeight = if ($bounds.Height -gt $maxDimension) { $maxDimension / $bounds.Height } else { 1.0 }
$resizeRatio = [Math]::Min($ratioWidth, $ratioHeight)

# Working dimensions (after resize)
$workWidth = [Math]::Floor($bounds.Width * $resizeRatio)
$workHeight = [Math]::Floor($bounds.Height * $resizeRatio)

# Resize screenshot if needed
if ($resizeRatio -lt 1.0) {
    $resized = New-Object System.Drawing.Bitmap([int]$workWidth, [int]$workHeight)
    $gResize = [System.Drawing.Graphics]::FromImage($resized)
    $gResize.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $gResize.DrawImage($screenshot, 0, 0, [int]$workWidth, [int]$workHeight)
    $gResize.Dispose()
    $screenshot.Dispose()
    $screenshot = $resized
}

# Calculate dimensions based on working size
$cellWidth = [Math]::Floor($workWidth / $gridSize)
$cellHeight = [Math]::Floor($workHeight / $gridSize)
$finalWidth = ($cellWidth * $gridSize) + ($gapSize * ($gridSize - 1)) + $rulerSize
$finalHeight = ($cellHeight * $gridSize) + ($gapSize * ($gridSize - 1)) + $rulerSize

# Save metadata: originalWidth,originalHeight,finalWidth,finalHeight
"$($bounds.Width),$($bounds.Height),$([int]$finalWidth),$([int]$finalHeight)" | Out-File -FilePath $metadataPath -Encoding ASCII -NoNewline

# Create final image with dark gray background (gaps will be visible)
$final = New-Object System.Drawing.Bitmap([int]$finalWidth, [int]$finalHeight)
$g = [System.Drawing.Graphics]::FromImage($final)
$g.Clear([System.Drawing.Color]::Black)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias

# Draw cells with gaps (from resized screenshot)
for ($row = 0; $row -lt $gridSize; $row++) {
    for ($col = 0; $col -lt $gridSize; $col++) {
        $srcX = $col * $cellWidth
        $srcY = $row * $cellHeight
        $destX = $rulerSize + ($col * ($cellWidth + $gapSize))
        $destY = $rulerSize + ($row * ($cellHeight + $gapSize))

        $srcRect = New-Object System.Drawing.Rectangle([int]$srcX, [int]$srcY, [int]$cellWidth, [int]$cellHeight)
        $destRect = New-Object System.Drawing.Rectangle([int]$destX, [int]$destY, [int]$cellWidth, [int]$cellHeight)

        $g.DrawImage($screenshot, $destRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
    }
}

# Draw rulers (top=letters, left=numbers) - like Excel
$font = New-Object System.Drawing.Font("Consolas", 12, [System.Drawing.FontStyle]::Bold)
$brush = [System.Drawing.Brushes]::White
$format = New-Object System.Drawing.StringFormat
$format.Alignment = [System.Drawing.StringAlignment]::Center
$format.LineAlignment = [System.Drawing.StringAlignment]::Center

for ($i = 0; $i -lt $gridSize; $i++) {
    # Calculate center of each cell for label placement
    $cellCenterX = $rulerSize + ($i * ($cellWidth + $gapSize)) + ($cellWidth / 2)
    $cellCenterY = $rulerSize + ($i * ($cellHeight + $gapSize)) + ($cellHeight / 2)

    # Top ruler - letters (A, B, C, ... T for 20 cols)
    $colLabel = [char]([int][char]'A' + $i)
    $g.DrawString($colLabel, $font, $brush, $cellCenterX, ($rulerSize / 2), $format)

    # Left ruler - numbers (1, 2, 3, ... 20)
    $rowLabel = ($i + 1).ToString()
    $g.DrawString($rowLabel, $font, $brush, ($rulerSize / 2), $cellCenterY, $format)
}

# Save as JPEG with specified quality
$jpegEncoder = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$encoderParams = New-Object System.Drawing.Imaging.EncoderParameters(1)
$encoderParams.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]$jpegQuality)
$final.Save($outputPath, $jpegEncoder, $encoderParams)

# Cleanup
$graphics.Dispose()
$g.Dispose()
$screenshot.Dispose()
$final.Dispose()
$font.Dispose()
`;
}

// ============================================================================
// Coordinate Conversion
// ============================================================================

/**
 * Convert grid coordinates to screen coordinates
 *
 * @param col - Grid column (0 to gridSize-1)
 * @param row - Grid row (0 to gridSize-1)
 * @param screenWidth - Original screen width in pixels
 * @param screenHeight - Original screen height in pixels
 * @param gridSize - Grid size (default: 20)
 * @returns Screen coordinates pointing to center of the cell
 *
 * @throws {VisionGridError} If coordinates are out of bounds
 *
 * @example
 * // Click center of cell (10, 8) on a 1920×1080 screen
 * const { x, y } = gridToScreen(10, 8, 1920, 1080);
 * // x = 1008, y = 459
 */
export function gridToScreen(
  col: number,
  row: number,
  screenWidth: number,
  screenHeight: number,
  gridSize: number = DEFAULTS.gridSize
): { x: number; y: number } {
  // Validate bounds
  if (col < 0 || col >= gridSize) {
    throw new VisionGridError(
      `Column ${col} out of bounds (0 to ${gridSize - 1})`,
      'COLUMN_OUT_OF_BOUNDS',
      { col, gridSize }
    );
  }
  if (row < 0 || row >= gridSize) {
    throw new VisionGridError(
      `Row ${row} out of bounds (0 to ${gridSize - 1})`,
      'ROW_OUT_OF_BOUNDS',
      { row, gridSize }
    );
  }

  // Each cell represents (100/gridSize)% of the screen
  // We target the center of the cell, hence +0.5
  const x = Math.round(((col + 0.5) / gridSize) * screenWidth);
  const y = Math.round(((row + 0.5) / gridSize) * screenHeight);

  return { x, y };
}

/**
 * Convert screen coordinates to grid coordinates
 *
 * @param x - Screen X coordinate
 * @param y - Screen Y coordinate
 * @param screenWidth - Screen width in pixels
 * @param screenHeight - Screen height in pixels
 * @param gridSize - Grid size (default: 20)
 * @returns Grid coordinates (col, row) clamped to valid range
 *
 * @example
 * // Find which cell contains pixel (500, 300) on a 1920×1080 screen
 * const { col, row } = screenToGrid(500, 300, 1920, 1080);
 * // col = 5, row = 5
 */
export function screenToGrid(
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number,
  gridSize: number = DEFAULTS.gridSize
): { col: number; row: number } {
  const col = Math.floor((x / screenWidth) * gridSize);
  const row = Math.floor((y / screenHeight) * gridSize);

  // Clamp to valid range
  return {
    col: Math.max(0, Math.min(gridSize - 1, col)),
    row: Math.max(0, Math.min(gridSize - 1, row)),
  };
}

// Export defaults for external use
export { DEFAULTS as VISION_GRID_DEFAULTS };

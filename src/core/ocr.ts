/**
 * Native OCR text detection module
 * Uses OS-native OCR APIs: Windows.Media.Ocr (Windows), Vision.framework (macOS)
 * No external dependencies - uses only built-in OS APIs
 *
 * Run on the full-screen screenshot buffer, then filter results to focused window bounds.
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, unlink, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));

/** A single word detected by OCR */
export interface OcrWord {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A line of text detected by OCR, containing 1+ words */
export interface OcrLine {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  words: OcrWord[];
}

/** Result of an OCR recognition pass */
export interface OcrResult {
  lines: OcrLine[];
  language?: string;
  duration_ms: number;
}

/**
 * Run OCR on a screenshot buffer.
 * Saves the buffer to a temp PNG file, invokes the platform-native OCR engine,
 * parses the JSON output, and cleans up.
 *
 * @param screenshotBuffer - PNG image buffer (from captureScreen().buffer)
 * @returns OcrResult with detected text lines, or empty result on failure
 */
export async function recognizeText(screenshotBuffer: Buffer): Promise<OcrResult> {
  const start = Date.now();

  // Write buffer to temp file for the OCR engine
  let tempDir: string | undefined;
  let tempFile: string | undefined;

  try {
    tempDir = await mkdtemp(join(tmpdir(), 'oscribe-ocr-'));
    tempFile = join(tempDir, 'ocr-input.png');
    await writeFile(tempFile, screenshotBuffer);

    if (process.platform === 'win32') {
      return await recognizeWindows(tempFile, start);
    } else if (process.platform === 'darwin') {
      return await recognizeMacOS(tempFile, start);
    } else {
      // Linux: no native OCR API available
      return { lines: [], duration_ms: Date.now() - start };
    }
  } catch (error) {
    console.warn('[ocr] OCR failed gracefully:', String(error));
    return { lines: [], duration_ms: Date.now() - start };
  } finally {
    // Cleanup temp file
    if (tempFile) {
      try { await unlink(tempFile); } catch { /* ignore */ }
    }
    if (tempDir) {
      try {
        const { rmdir } = await import('node:fs/promises');
        await rmdir(tempDir);
      } catch { /* ignore */ }
    }
  }
}

/**
 * Windows: Invoke ocr-recognize.ps1 with Windows.Media.Ocr API
 */
async function recognizeWindows(imagePath: string, startTime: number): Promise<OcrResult> {
  const scriptPath = join(__dirname, '..', '..', '..', 'scripts', 'windows', 'ocr-recognize.ps1');

  const { stdout } = await execAsync(
    `powershell -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -ImagePath "${imagePath}"`,
    { maxBuffer: 10 * 1024 * 1024, timeout: 15000, windowsHide: true },
  );

  return parseOcrOutput(stdout, startTime);
}

/**
 * macOS: Invoke ocr-reader binary (compiled from Swift with Vision.framework)
 */
async function recognizeMacOS(imagePath: string, startTime: number): Promise<OcrResult> {
  const binaryPath = join(__dirname, '..', '..', '..', 'bin', 'ocr-reader');

  if (!existsSync(binaryPath)) {
    console.warn('[ocr] ocr-reader binary not found. Run: swiftc scripts/macos/ocr-reader.swift -o bin/ocr-reader -framework Vision -framework AppKit');
    return { lines: [], duration_ms: Date.now() - startTime };
  }

  const { stdout } = await execAsync(
    `"${binaryPath}" "${imagePath}"`,
    { maxBuffer: 10 * 1024 * 1024, timeout: 15000 },
  );

  return parseOcrOutput(stdout, startTime);
}

/**
 * Parse JSON output from the OCR scripts (same format on Windows and macOS)
 */
function parseOcrOutput(stdout: string, startTime: number): OcrResult {
  const result = stdout.trim();
  if (!result || result === '[]') {
    return { lines: [], duration_ms: Date.now() - startTime };
  }

  const parsed = JSON.parse(result) as {
    lines: Array<{
      text: string;
      bounds: { x: number; y: number; width: number; height: number };
      words?: Array<{
        text: string;
        bounds: { x: number; y: number; width: number; height: number };
      }>;
    }>;
    language?: string;
  };

  const lines: OcrLine[] = parsed.lines.map((line) => ({
    text: line.text,
    x: line.bounds.x,
    y: line.bounds.y,
    width: line.bounds.width,
    height: line.bounds.height,
    words: line.words
      ? line.words.map((w) => ({
          text: w.text,
          x: w.bounds.x,
          y: w.bounds.y,
          width: w.bounds.width,
          height: w.bounds.height,
        }))
      : [{ text: line.text, x: line.bounds.x, y: line.bounds.y, width: line.bounds.width, height: line.bounds.height }],
  }));

  return {
    lines,
    ...(parsed.language ? { language: parsed.language } : {}),
    duration_ms: Date.now() - startTime,
  };
}

/**
 * Filter OCR results to only include lines within the focused window bounds.
 * Uses the line's center point to determine if it's inside the window.
 */
export function filterByWindow(
  lines: OcrLine[],
  bounds: { x: number; y: number; width: number; height: number },
): OcrLine[] {
  return lines.filter((line) => {
    const cx = line.x + Math.floor(line.width / 2);
    const cy = line.y + Math.floor(line.height / 2);
    return (
      cx >= bounds.x &&
      cx <= bounds.x + bounds.width &&
      cy >= bounds.y &&
      cy <= bounds.y + bounds.height
    );
  });
}

/**
 * Deduplicate OCR results against UIA elements.
 * Removes OCR lines whose text already appears in a UIA element
 * with significant spatial overlap (IoU > 0.3).
 */
export function deduplicateOcr(
  ocrLines: OcrLine[],
  uiaElements: Array<{ name: string; x: number; y: number; width: number; height: number }>,
): OcrLine[] {
  return ocrLines.filter((line) => {
    const isDuplicate = uiaElements.some((el) => {
      if (!el.name) return false;

      const ocrText = line.text.toLowerCase().trim();
      const uiaText = el.name.toLowerCase().trim();
      if (!ocrText || !uiaText) return false;

      // Text similarity: one contains the other
      const textMatch = uiaText.includes(ocrText) || ocrText.includes(uiaText);
      if (!textMatch) return false;

      // Spatial overlap via IoU
      const iou = calculateIoU(
        { x: line.x, y: line.y, w: line.width, h: line.height },
        { x: el.x, y: el.y, w: el.width, h: el.height },
      );

      return iou > 0.3;
    });

    return !isDuplicate;
  });
}

/** Calculate Intersection over Union of two rectangles */
function calculateIoU(
  a: { x: number; y: number; w: number; h: number },
  b: { x: number; y: number; w: number; h: number },
): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);

  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  if (intersection === 0) return 0;

  const areaA = a.w * a.h;
  const areaB = b.w * b.h;
  const union = areaA + areaB - intersection;

  return union > 0 ? intersection / union : 0;
}

/**
 * Format OCR results for display in os_screenshot output.
 * Uses 2-level hierarchy: line with nested words (when 2+ words).
 */
export function formatOcrText(lines: OcrLine[]): string {
  if (lines.length === 0) return '';

  return lines.map((line) => {
    const cx = line.x + Math.floor(line.width / 2);
    const cy = line.y + Math.floor(line.height / 2);
    const lineStr = `- "${line.text}" center=(${cx},${cy}) [${line.width}x${line.height}]`;

    // Only show sub-words when there are 2+ words
    if (line.words.length > 1) {
      const wordsStr = line.words.map((w) => {
        const wcx = w.x + Math.floor(w.width / 2);
        const wcy = w.y + Math.floor(w.height / 2);
        return `  - "${w.text}" center=(${wcx},${wcy}) [${w.width}x${w.height}]`;
      }).join('\n');
      return `${lineStr}\n${wordsStr}`;
    }

    return lineStr;
  }).join('\n');
}

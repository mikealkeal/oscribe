/**
 * NVDA Screen Reader Management
 *
 * Manages NVDA portable for Electron app accessibility on Windows.
 * NVDA uses DLL injection to enable Chromium/Electron accessibility trees
 * that are otherwise invisible to Windows UI Automation.
 *
 * Why NVDA is needed:
 * - Electron/Chromium only exposes its accessibility tree when a screen reader is detected
 * - NVDA registers IAccessible2 proxy from INSIDE the target process via DLL injection
 * - External API calls (SetWindowsHookEx, WM_GETOBJECT) don't trigger this behavior
 * - Result: 110+ UI elements detected vs 3 without NVDA
 *
 * License note:
 * - NVDA is GPL v2 - cannot be bundled with osbot (BSL 1.1)
 * - Downloaded on-demand as external tool, not distributed
 * - User must accept NVDA license when downloading
 */

import { exec, spawn, ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { loadConfig } from '../config/index.js';
const execAsync = promisify(exec);

// Simple logger for NVDA module
const logger = {
  debug: (msg: string, data?: Record<string, unknown>) => {
    if (process.env['DEBUG']) console.log(`[nvda] ${msg}`, data ?? '');
  },
  info: (msg: string, data?: Record<string, unknown>) => {
    console.log(`[nvda] ${msg}`, data ?? '');
  },
  warn: (msg: string, data?: Record<string, unknown>) => {
    console.warn(`[nvda] ${msg}`, data ?? '');
  },
  error: (msg: string, data?: Record<string, unknown>) => {
    console.error(`[nvda] ${msg}`, data ?? '');
  },
};

// NVDA portable download URL (NV Access official)
// Using official installer - can extract as portable with --portable flag
const NVDA_DOWNLOAD_URL = 'https://download.nvaccess.org/releases/2025.3.2/nvda_2025.3.2.exe';
const NVDA_VERSION = '2025.3.2';

// Default paths (can be overridden via config.nvda.customPath)
const TOOLS_DIR = join(homedir(), '.osbot', 'tools');
const DEFAULT_NVDA_DIR = join(TOOLS_DIR, 'nvda');

/**
 * Get NVDA paths - checks customPath config first
 */
function getNvdaPaths(): { dir: string; exe: string; configDir: string; configFile: string } {
  const config = loadConfig();
  const nvdaDir = config.nvda.customPath || DEFAULT_NVDA_DIR;
  return {
    dir: nvdaDir,
    exe: join(nvdaDir, 'nvda_noUIAccess.exe'),
    configDir: join(nvdaDir, 'userConfig'),
    configFile: join(nvdaDir, 'userConfig', 'nvda.ini'),
  };
}

// Legacy constants for backward compatibility
const NVDA_DIR = DEFAULT_NVDA_DIR;
const NVDA_EXE = join(NVDA_DIR, 'nvda_noUIAccess.exe');
const NVDA_CONFIG_DIR = join(NVDA_DIR, 'userConfig');
const NVDA_CONFIG_FILE = join(NVDA_CONFIG_DIR, 'nvda.ini');

// Silent config for NVDA - no audio output
const SILENT_CONFIG = `schemaVersion = 13
[general]
	playStartAndExitSounds = False
	saveConfigurationOnExit = False
	showWelcomeDialogAtStartup = False

[speech]
	synth = silence
	outputDevice = default

[audio]
	soundVolume = 0
	soundVolumeFollowsVoice = False
`;

// Track NVDA process
let nvdaProcess: ChildProcess | null = null;

export interface NvdaStatus {
  installed: boolean;
  version: string | undefined;
  configValid: boolean;
  running: boolean;
  pid: number | undefined;
}

/**
 * Check if NVDA portable is installed
 * Checks customPath first, then default location
 */
export function isNvdaInstalled(): boolean {
  const paths = getNvdaPaths();
  return existsSync(paths.exe);
}

/**
 * Check if silent config exists and is valid
 */
export function isConfigValid(): boolean {
  const paths = getNvdaPaths();
  if (!existsSync(paths.configFile)) {
    return false;
  }

  try {
    const config = readFileSync(paths.configFile, 'utf-8');
    // Check for key silent settings
    return config.includes('synth = silence') &&
           config.includes('playStartAndExitSounds = False');
  } catch {
    return false;
  }
}

/**
 * Ensure silent config exists
 */
export function ensureSilentConfig(): void {
  const paths = getNvdaPaths();
  if (!existsSync(paths.configDir)) {
    mkdirSync(paths.configDir, { recursive: true });
  }

  // Always overwrite to ensure correct config
  writeFileSync(paths.configFile, SILENT_CONFIG, 'utf-8');
  logger.debug('NVDA silent config created/updated');
}

/**
 * Check if NVDA is currently running (any instance)
 * Checks for both nvda.exe (standard) and nvda_noUIAccess.exe (portable without UI Access)
 */
export async function isNvdaRunning(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return false;
  }

  try {
    // Check for nvda.exe (standard NVDA installation)
    const { stdout: stdout1 } = await execAsync('tasklist /FI "IMAGENAME eq nvda.exe" /NH', {
      timeout: 5000,
    });
    if (stdout1.toLowerCase().includes('nvda.exe')) {
      return true;
    }

    // Check for nvda_noUIAccess.exe (portable NVDA without UI Access)
    const { stdout: stdout2 } = await execAsync('tasklist /FI "IMAGENAME eq nvda_noUIAccess.exe" /NH', {
      timeout: 5000,
    });
    return stdout2.toLowerCase().includes('nvda_nouiaccess.exe');
  } catch {
    return false;
  }
}

/**
 * Get full NVDA status
 */
export async function getNvdaStatus(): Promise<NvdaStatus> {
  const installed = isNvdaInstalled();
  const configValid = isConfigValid();
  const running = await isNvdaRunning();

  return {
    installed,
    version: installed ? NVDA_VERSION : undefined,
    configValid,
    running,
    pid: nvdaProcess?.pid,
  };
}

/**
 * Download NVDA portable
 * Returns path to downloaded file
 */
export async function downloadNvda(onProgress?: (percent: number) => void): Promise<string> {
  // Ensure tools directory exists
  if (!existsSync(TOOLS_DIR)) {
    mkdirSync(TOOLS_DIR, { recursive: true });
  }

  const downloadPath = join(tmpdir(), `nvda_${NVDA_VERSION}.exe`);

  logger.info('Downloading NVDA portable...');
  logger.info(`URL: ${NVDA_DOWNLOAD_URL}`);

  try {
    // Use PowerShell for download with progress
    const psScript = `
$ProgressPreference = 'SilentlyContinue'
$url = '${NVDA_DOWNLOAD_URL}'
$output = '${downloadPath.replace(/\\/g, '\\\\')}'

try {
    $webClient = New-Object System.Net.WebClient
    $webClient.DownloadFile($url, $output)
    Write-Host "OK"
} catch {
    Write-Host "ERROR: $_"
    exit 1
}
`;

    const { stdout, stderr } = await execAsync(
      `powershell -NoProfile -ExecutionPolicy Bypass -Command "${psScript.replace(/"/g, '\\"').replace(/\n/g, '; ')}"`,
      { timeout: 300000 } // 5 min timeout for download
    );

    if (!stdout.includes('OK')) {
      throw new Error(stderr || 'Download failed');
    }

    if (!existsSync(downloadPath)) {
      throw new Error('Downloaded file not found');
    }

    logger.info('Download complete');
    return downloadPath;
  } catch (error) {
    logger.error('Failed to download NVDA', { error });
    throw error;
  }
}

/**
 * Extract NVDA portable from installer
 */
export async function extractNvda(installerPath: string): Promise<void> {
  const paths = getNvdaPaths();
  logger.info('Extracting NVDA portable...');

  // Ensure NVDA directory exists
  if (!existsSync(paths.dir)) {
    mkdirSync(paths.dir, { recursive: true });
  }

  try {
    // NVDA installer supports --create-portable and --create-portable-silent
    // This creates a portable copy in the specified directory
    logger.info(`Extracting to: ${paths.dir}`);

    const { stdout, stderr } = await execAsync(
      `"${installerPath}" --create-portable-silent --portable-path="${paths.dir}"`,
      { timeout: 180000 } // 3 min timeout for extraction
    );

    logger.debug('Extraction output', { stdout, stderr });

    // Wait for extraction to complete
    await new Promise(resolve => setTimeout(resolve, 3000));

    if (!existsSync(paths.exe)) {
      // Check if files are in a subdirectory
      const altExe = join(paths.dir, 'nvda.exe');
      if (existsSync(altExe)) {
        logger.info('NVDA extracted (using nvda.exe)');
      } else {
        throw new Error(`NVDA exe not found at ${paths.exe} or ${altExe}`);
      }
    }

    logger.info('NVDA portable extracted successfully');
  } catch (error) {
    logger.error('Failed to extract NVDA', { error });
    throw error;
  }
}

/**
 * Check if 7z is available
 */
async function check7zAvailable(): Promise<boolean> {
  try {
    await execAsync('7z', { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialize NVDA - download and configure if needed
 * @param forceDownload - bypass autoDownload config check (for CLI install command)
 */
export async function initNvda(forceDownload = false): Promise<boolean> {
  if (process.platform !== 'win32') {
    logger.debug('NVDA only supported on Windows');
    return false;
  }

  // Check if already installed
  if (isNvdaInstalled()) {
    // Just ensure config is valid
    if (!isConfigValid()) {
      ensureSilentConfig();
    }
    return true;
  }

  // Check config before downloading
  const config = loadConfig();
  if (!forceDownload && !config.nvda.autoDownload) {
    logger.warn('NVDA not installed. Run "osbot nvda install" to download.');
    return false;
  }

  // Need to download and install
  try {
    const installerPath = await downloadNvda();
    await extractNvda(installerPath);
    ensureSilentConfig();
    return true;
  } catch (error) {
    logger.error('Failed to initialize NVDA', { error });
    return false;
  }
}

/**
 * Start NVDA silently
 * @param autoInit - try to download if not installed (respects config.nvda.autoDownload)
 */
export async function startNvda(autoInit = false): Promise<boolean> {
  if (process.platform !== 'win32') {
    return false;
  }

  // Check if already running
  if (await isNvdaRunning()) {
    logger.debug('NVDA already running');
    return true;
  }

  // Check if installed
  if (!isNvdaInstalled()) {
    if (autoInit) {
      const initialized = await initNvda();
      if (!initialized) {
        return false;
      }
    } else {
      logger.warn('NVDA not installed. Run "osbot nvda install" first.');
      return false;
    }
  }

  // Ensure silent config
  ensureSilentConfig();

  try {
    const paths = getNvdaPaths();
    logger.info('Starting NVDA in silent mode...');

    // Start NVDA with minimal mode and custom config
    nvdaProcess = spawn(paths.exe, ['--minimal', `-c=${paths.configDir}`], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    nvdaProcess.unref();

    // Wait for NVDA to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    const running = await isNvdaRunning();
    if (running) {
      logger.info('NVDA started successfully');
    } else {
      logger.warn('NVDA may not have started correctly');
    }

    return running;
  } catch (error) {
    logger.error('Failed to start NVDA', { error });
    return false;
  }
}

/**
 * Stop NVDA
 */
export async function stopNvda(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return true;
  }

  try {
    // Kill all NVDA processes
    await execAsync('taskkill /F /IM nvda.exe', { timeout: 5000 });
    nvdaProcess = null;
    logger.info('NVDA stopped');
    return true;
  } catch {
    // Process may not exist, that's fine
    nvdaProcess = null;
    return true;
  }
}

// Track if we've already warned about missing NVDA (avoid spam)
let nvdaWarningShown = false;

/**
 * Ensure NVDA is running (for Electron app accessibility)
 * Call this before accessing Electron app UI elements
 *
 * Respects config:
 * - nvda.autoStart: if false, won't start NVDA automatically
 * - nvda.autoDownload: if false, won't download NVDA automatically
 */
export async function ensureNvdaForElectron(): Promise<boolean> {
  if (process.platform !== 'win32') {
    return false;
  }

  const config = loadConfig();

  // Check if auto-start is disabled
  if (!config.nvda.autoStart) {
    return false;
  }

  // Check if already running
  if (await isNvdaRunning()) {
    return true;
  }

  // Check if installed
  if (!isNvdaInstalled()) {
    if (!nvdaWarningShown) {
      logger.warn('NVDA not installed - Electron apps may show limited UI elements.');
      logger.warn('Run "osbot nvda install" to enable full accessibility.');
      nvdaWarningShown = true;
    }

    // Try to init if autoDownload is enabled
    if (config.nvda.autoDownload) {
      return startNvda(true);
    }
    return false;
  }

  // Start NVDA
  return startNvda(false);
}

// Export paths for testing/debugging (uses getNvdaPaths internally)
export function getPaths() {
  const p = getNvdaPaths();
  return {
    toolsDir: TOOLS_DIR,
    nvdaDir: p.dir,
    nvdaExe: p.exe,
    configDir: p.configDir,
    configFile: p.configFile,
  };
}

// Legacy export for backward compatibility
export const paths = {
  toolsDir: TOOLS_DIR,
  nvdaDir: DEFAULT_NVDA_DIR,
  nvdaExe: join(DEFAULT_NVDA_DIR, 'nvda_noUIAccess.exe'),
  configDir: join(DEFAULT_NVDA_DIR, 'userConfig'),
  configFile: join(DEFAULT_NVDA_DIR, 'userConfig', 'nvda.ini'),
};

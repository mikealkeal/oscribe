/**
 * Unity Bridge Setup
 *
 * Automates the full Unity Bridge setup for any Unity Mono game (Windows & macOS):
 * 1. Detect game type, runtime, available DLLs
 * 2. Download and install BepInEx 5 mod loader
 * 3. Build OScribe Bridge plugin (adapted to game's DLLs)
 * 4. Deploy plugin to BepInEx/plugins/
 *
 * Skills applied:
 * - cross-platform-compatibility: path.join(), os.homedir(), platform branching
 * - error-handling-patterns: UnitySetupError, graceful degradation, Result pattern
 * - typescript-expert: strict interfaces, ESM-first, satisfies
 * - nodejs-best-practices: async/await, layered architecture
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  readFileSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const execAsync = promisify(exec);

// ============================================================================
// Constants
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// From dist/core/ → oscribe root → plugins/unity-bridge/
const PLUGIN_SOURCE_DIR = join(__dirname, '..', '..', 'plugins', 'unity-bridge');

const isWindows = process.platform === 'win32';
const isMacOS = process.platform === 'darwin';

const BEPINEX_VERSION = '5.4.23.2';

const BEPINEX_URLS = {
  win_x64: `https://github.com/BepInEx/BepInEx/releases/download/v${BEPINEX_VERSION}/BepInEx_win_x64_${BEPINEX_VERSION}.zip`,
  win_x86: `https://github.com/BepInEx/BepInEx/releases/download/v${BEPINEX_VERSION}/BepInEx_win_x86_${BEPINEX_VERSION}.zip`,
  macos_x64: `https://github.com/BepInEx/BepInEx/releases/download/v${BEPINEX_VERSION}/BepInEx_macos_x64_${BEPINEX_VERSION}.zip`,
} satisfies Record<string, string>;

const TOOLS_DIR = join(homedir(), '.oscribe', 'tools');
const BUILDS_DIR = join(homedir(), '.oscribe', 'unity-builds');

const REQUIRED_DLLS = [
  'UnityEngine.dll',
  'UnityEngine.CoreModule.dll',
  'UnityEngine.UI.dll',
  'UnityEngine.UIModule.dll',
  'UnityEngine.PhysicsModule.dll',
  'UnityEngine.Physics2DModule.dll',
] satisfies string[];

const OPTIONAL_DLLS = {
  tmpro: 'Unity.TextMeshPro.dll',
  newtonsoft: 'Newtonsoft.Json.dll',
} satisfies Record<string, string>;

// ============================================================================
// Types
// ============================================================================

export interface GameAnalysis {
  gamePath: string;
  gameName: string;
  exePath: string;
  appBundlePath?: string;
  dataFolder: string;
  managedFolder: string;
  runtime: 'mono' | 'il2cpp';
  platform: 'windows' | 'macos';
  is64bit: boolean;
  bepinexInstalled: boolean;
  pluginDeployed: boolean;
  gameRunning: boolean;
  availableDlls: { required: Record<string, boolean>; optional: Record<string, boolean> };
  compilationMode: 'lite' | 'full';
}

export interface UnitySetupResult {
  success: boolean;
  gamePath: string;
  gameName: string;
  platform: 'windows' | 'macos';
  runtime: 'mono' | 'il2cpp' | 'unknown';
  compilationMode?: 'lite' | 'full';
  steps: UnitySetupStep[];
  nextStep?: string;
  error?: string;
}

export interface UnitySetupStep {
  name: string;
  status: 'skipped' | 'success' | 'error' | 'pending';
  message: string;
  duration_ms?: number;
}

export class UnitySetupError extends Error {
  constructor(
    message: string,
    public code: string,
  ) {
    super(message);
    this.name = 'UnitySetupError';
  }
}

// ============================================================================
// Main entry point
// ============================================================================

export async function setupUnityBridge(options: {
  gamePath?: string;
  step?: 'auto' | 'detect' | 'bepinex' | 'build' | 'deploy';
  force?: boolean;
}): Promise<UnitySetupResult> {
  const step = options.step ?? 'auto';
  const force = options.force ?? false;
  const steps: UnitySetupStep[] = [];
  const platform = isWindows ? 'windows' : 'macos';

  // Step 1: Detect
  let analysis: GameAnalysis;
  const detectStart = Date.now();
  try {
    analysis = await analyzeGame(options.gamePath);
    steps.push({
      name: 'Detect',
      status: 'success',
      message: `Unity ${analysis.runtime === 'mono' ? 'Mono' : 'IL2CPP'} game "${analysis.gameName}" (${analysis.managedFolder})`,
      duration_ms: Date.now() - detectStart,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    steps.push({ name: 'Detect', status: 'error', message: msg, duration_ms: Date.now() - detectStart });
    return {
      success: false,
      gamePath: options.gamePath ?? 'unknown',
      gameName: 'unknown',
      platform: platform as 'windows' | 'macos',
      runtime: 'unknown',
      steps,
      error: msg,
    };
  }

  if (step === 'detect') {
    const dllSummary = Object.entries(analysis.availableDlls.required)
      .filter(([, v]) => v)
      .length;
    const mode = analysis.compilationMode;
    steps[0]!.message += ` | ${dllSummary}/${REQUIRED_DLLS.length} DLLs | mode: ${mode}`;
    if (analysis.bepinexInstalled) steps[0]!.message += ' | BepInEx: installed';
    if (analysis.pluginDeployed) steps[0]!.message += ' | Plugin: deployed';
    if (analysis.gameRunning) steps[0]!.message += ' | Game: running';
    return {
      success: true,
      gamePath: analysis.gamePath,
      gameName: analysis.gameName,
      platform: analysis.platform,
      runtime: analysis.runtime,
      compilationMode: analysis.compilationMode,
      steps,
    };
  }

  if (analysis.runtime === 'il2cpp') {
    return {
      success: false,
      gamePath: analysis.gamePath,
      gameName: analysis.gameName,
      platform: analysis.platform,
      runtime: 'il2cpp',
      steps,
      error: 'This game uses IL2CPP runtime. Only Unity Mono games are supported. Look for MonoBleedingEdge/ folder.',
    };
  }

  // Step 2: BepInEx
  if (step === 'auto' || step === 'bepinex') {
    const bepStart = Date.now();
    const bepResult = await installBepInEx(analysis, force);
    bepResult.duration_ms = Date.now() - bepStart;
    steps.push(bepResult);
    if (bepResult.status === 'error') {
      return {
        success: false,
        gamePath: analysis.gamePath,
        gameName: analysis.gameName,
        platform: analysis.platform,
        runtime: analysis.runtime,
        compilationMode: analysis.compilationMode,
        steps,
        error: bepResult.message,
      };
    }
    // Re-check after install
    if (bepResult.status === 'success') {
      analysis.bepinexInstalled = true;
    }
  }

  // Step 3: Build
  if (step === 'auto' || step === 'build') {
    const buildStart = Date.now();
    const buildResult = await buildPlugin(analysis);
    buildResult.duration_ms = Date.now() - buildStart;
    steps.push(buildResult);
    if (buildResult.status === 'error') {
      return {
        success: false,
        gamePath: analysis.gamePath,
        gameName: analysis.gameName,
        platform: analysis.platform,
        runtime: analysis.runtime,
        compilationMode: analysis.compilationMode,
        steps,
        error: buildResult.message,
      };
    }
  }

  // Step 4: Deploy
  if (step === 'auto' || step === 'deploy') {
    const deployStart = Date.now();
    const deployResult = await deployPlugin(analysis);
    deployResult.duration_ms = Date.now() - deployStart;
    steps.push(deployResult);

    const nextStep = getNextStepMessage(analysis, deployResult);
    return {
      success: deployResult.status !== 'error',
      gamePath: analysis.gamePath,
      gameName: analysis.gameName,
      platform: analysis.platform,
      runtime: analysis.runtime,
      compilationMode: analysis.compilationMode,
      steps,
      nextStep,
    };
  }

  return {
    success: true,
    gamePath: analysis.gamePath,
    gameName: analysis.gameName,
    platform: analysis.platform,
    runtime: analysis.runtime,
    compilationMode: analysis.compilationMode,
    steps,
  };
}

// ============================================================================
// Step 1: Detect & Analyze
// ============================================================================

async function analyzeGame(gamePath?: string): Promise<GameAnalysis> {
  const platform = isWindows ? 'windows' : 'macos';

  // Resolve game path
  gamePath ??= await detectGamePathFromWindow();
  if (!existsSync(gamePath)) {
    throw new UnitySetupError(`Game folder not found: ${gamePath}`, 'GAME_NOT_FOUND');
  }

  // Find data/managed folders
  const { dataFolder, managedFolder, gameName, exePath, appBundlePath } = findGameFolders(gamePath);

  // Detect runtime
  const runtime = detectRuntime(gamePath, appBundlePath);

  // Detect architecture
  const is64bit = detect64bit(gamePath);

  // Scan DLLs
  const availableDlls = scanDlls(managedFolder);

  // Check missing required DLLs
  const missingDlls = Object.entries(availableDlls.required)
    .filter(([, present]) => !present)
    .map(([name]) => name);
  if (missingDlls.length > 0) {
    throw new UnitySetupError(
      `Missing required DLLs in ${managedFolder}: ${missingDlls.join(', ')}`,
      'MISSING_DLLS',
    );
  }

  // BepInEx status
  const bepinexInstalled = isWindows
    ? existsSync(join(gamePath, 'BepInEx', 'core', 'BepInEx.dll'))
    : existsSync(join(gamePath, 'BepInEx', 'core', 'BepInEx.dll')) ||
      existsSync(join(gamePath, 'BepInEx', 'core', 'BepInEx.Core.dll'));

  // Plugin status
  const pluginDeployed = existsSync(join(gamePath, 'BepInEx', 'plugins', 'OScribeBridge.dll'));

  // Game running
  const gameRunning = await isGameRunning(exePath);

  // Compilation mode
  const hasTmpro = availableDlls.optional['Unity.TextMeshPro.dll'] === true;
  const hasNewtonsoft = availableDlls.optional['Newtonsoft.Json.dll'] === true;
  const compilationMode = hasTmpro && hasNewtonsoft ? 'full' : 'lite';

  const result: GameAnalysis = {
    gamePath,
    gameName,
    exePath,
    dataFolder,
    managedFolder,
    runtime,
    platform: platform as 'windows' | 'macos',
    is64bit,
    bepinexInstalled,
    pluginDeployed,
    gameRunning,
    availableDlls,
    compilationMode,
  };
  if (appBundlePath) result.appBundlePath = appBundlePath;
  return result;
}

function findGameFolders(gamePath: string): {
  dataFolder: string;
  managedFolder: string;
  gameName: string;
  exePath: string;
  appBundlePath?: string;
} {
  if (isWindows) {
    // Windows: look for *_Data/Managed/
    const entries = readdirSync(gamePath, { withFileTypes: true });
    const dataDir = entries.find(
      (e) => e.isDirectory() && e.name.endsWith('_Data') && existsSync(join(gamePath, e.name, 'Managed')),
    );
    if (!dataDir) {
      throw new UnitySetupError(
        `No *_Data/Managed/ folder found in ${gamePath}. This may not be a Unity game.`,
        'NOT_UNITY',
      );
    }
    const gameName = dataDir.name.replace(/_Data$/, '');
    const exePath = join(gamePath, `${gameName}.exe`);
    return {
      dataFolder: join(gamePath, dataDir.name),
      managedFolder: join(gamePath, dataDir.name, 'Managed'),
      gameName,
      exePath,
    };
  } else {
    // macOS: look for *.app/Contents/Resources/Data/Managed/
    const entries = readdirSync(gamePath, { withFileTypes: true });
    const appBundle = entries.find(
      (e) =>
        e.isDirectory() &&
        e.name.endsWith('.app') &&
        existsSync(join(gamePath, e.name, 'Contents', 'Resources', 'Data', 'Managed')),
    );
    if (!appBundle) {
      throw new UnitySetupError(
        `No *.app/Contents/Resources/Data/Managed/ found in ${gamePath}. This may not be a Unity game.`,
        'NOT_UNITY',
      );
    }
    const appBundlePath = join(gamePath, appBundle.name);
    const gameName = appBundle.name.replace(/\.app$/, '');
    const dataFolder = join(appBundlePath, 'Contents', 'Resources', 'Data');
    const managedFolder = join(dataFolder, 'Managed');

    // Find the actual executable from the bundle
    let exePath = join(appBundlePath, 'Contents', 'MacOS', gameName);
    // If executable name doesn't match, scan the MacOS directory
    if (!existsSync(exePath)) {
      const macosDir = join(appBundlePath, 'Contents', 'MacOS');
      if (existsSync(macosDir)) {
        const exes = readdirSync(macosDir);
        if (exes.length > 0) {
          exePath = join(macosDir, exes[0]!);
        }
      }
    }

    return { dataFolder, managedFolder, gameName, exePath, appBundlePath };
  }
}

function detectRuntime(gamePath: string, appBundlePath?: string): 'mono' | 'il2cpp' {
  if (isWindows) {
    if (existsSync(join(gamePath, 'MonoBleedingEdge'))) return 'mono';
    if (existsSync(join(gamePath, 'GameAssembly.dll'))) return 'il2cpp';
  } else if (appBundlePath) {
    const dataPath = join(appBundlePath, 'Contents', 'Resources', 'Data');
    if (existsSync(join(dataPath, 'Mono')) || existsSync(join(gamePath, 'MonoBleedingEdge'))) return 'mono';
    if (existsSync(join(gamePath, 'GameAssembly.dylib')) || existsSync(join(appBundlePath, 'Contents', 'Frameworks', 'GameAssembly.dylib'))) return 'il2cpp';
  }
  // Default to mono if can't determine (Managed/ folder exists)
  return 'mono';
}

function detect64bit(gamePath: string): boolean {
  if (isWindows) {
    return existsSync(join(gamePath, 'MonoBleedingEdge', 'x86_64'));
  }
  // macOS: BepInEx only provides x64, assume x64
  return true;
}

function scanDlls(managedFolder: string): { required: Record<string, boolean>; optional: Record<string, boolean> } {
  const required: Record<string, boolean> = {};
  for (const dll of REQUIRED_DLLS) {
    required[dll] = existsSync(join(managedFolder, dll));
  }
  const optional: Record<string, boolean> = {};
  for (const dll of Object.values(OPTIONAL_DLLS)) {
    optional[dll] = existsSync(join(managedFolder, dll));
  }
  return { required, optional };
}

async function isGameRunning(exePath: string): Promise<boolean> {
  const exeName = basename(exePath);
  try {
    if (isWindows) {
      const { stdout } = await execAsync(
        `powershell -Command "Get-Process | Where-Object { $_.ProcessName -eq '${exeName.replace(/\.exe$/i, '')}' } | Select-Object -First 1 | ForEach-Object { $_.Id }"`,
      );
      return stdout.trim().length > 0;
    } else {
      const { stdout } = await execAsync(`pgrep -f "${exeName}"`);
      return stdout.trim().length > 0;
    }
  } catch {
    return false;
  }
}

async function detectGamePathFromWindow(): Promise<string> {
  if (isWindows) {
    try {
      const { stdout } = await execAsync(
        `powershell -Command "Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class W { [DllImport(\\"user32.dll\\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\\"user32.dll\\")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid); }'; $h = [W]::GetForegroundWindow(); $pid = 0; [W]::GetWindowThreadProcessId($h, [ref]$pid) | Out-Null; (Get-Process -Id $pid).Path"`,
      );
      const exePath = stdout.trim();
      if (exePath) return dirname(exePath);
    } catch { /* fall through */ }
  } else if (isMacOS) {
    try {
      const { stdout } = await execAsync(
        `osascript -e 'tell application "System Events" to get POSIX path of (file of first process whose frontmost is true)'`,
      );
      const appPath = stdout.trim();
      if (appPath) return dirname(appPath);
    } catch { /* fall through */ }
  }
  throw new UnitySetupError(
    'Could not detect game from active window. Please provide gamePath explicitly.',
    'AUTO_DETECT_FAILED',
  );
}

// ============================================================================
// Step 2: Install BepInEx
// ============================================================================

async function installBepInEx(analysis: GameAnalysis, force: boolean): Promise<UnitySetupStep> {
  if (analysis.bepinexInstalled && !force) {
    return { name: 'BepInEx', status: 'skipped', message: `Already installed in ${analysis.gamePath}` };
  }

  // Determine download URL
  let urlKey: keyof typeof BEPINEX_URLS;
  if (isWindows) {
    urlKey = analysis.is64bit ? 'win_x64' : 'win_x86';
  } else {
    urlKey = 'macos_x64';
  }
  const url = BEPINEX_URLS[urlKey];
  const zipName = `BepInEx_${urlKey}_${BEPINEX_VERSION}.zip`;

  // Ensure tools dir
  mkdirSync(TOOLS_DIR, { recursive: true });
  const zipPath = join(TOOLS_DIR, zipName);

  // Download (cached)
  if (!existsSync(zipPath) || force) {
    try {
      await downloadFile(url, zipPath);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { name: 'BepInEx', status: 'error', message: `Download failed: ${msg}` };
    }
  }

  // Extract
  try {
    await extractZip(zipPath, analysis.gamePath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: 'BepInEx', status: 'error', message: `Extract failed: ${msg}` };
  }

  // Create BepInEx subdirectories
  const bepinexDir = join(analysis.gamePath, 'BepInEx');
  for (const sub of ['plugins', 'config', 'patchers']) {
    mkdirSync(join(bepinexDir, sub), { recursive: true });
  }

  // macOS: configure run_bepinex.sh
  if (isMacOS && analysis.appBundlePath) {
    const scriptPath = join(analysis.gamePath, 'run_bepinex.sh');
    if (existsSync(scriptPath)) {
      const appName = basename(analysis.appBundlePath);
      let content = readFileSync(scriptPath, 'utf-8');
      content = content.replace(/executable_name="[^"]*"/, `executable_name="${appName}"`);
      writeFileSync(scriptPath, content, 'utf-8');
      chmodSync(scriptPath, 0o755);
    }
  }

  const platformLabel = isWindows ? (analysis.is64bit ? 'x64' : 'x86') : 'macOS x64';
  return {
    name: 'BepInEx',
    status: 'success',
    message: `v${BEPINEX_VERSION} ${platformLabel} installed`,
  };
}

async function downloadFile(url: string, dest: string): Promise<void> {
  if (isWindows) {
    await execAsync(
      `powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object Net.WebClient).DownloadFile('${url}', '${dest}')"`,
      { timeout: 60_000 },
    );
  } else {
    await execAsync(`curl -L -o "${dest}" "${url}"`, { timeout: 60_000 });
  }
}

async function extractZip(zipPath: string, destDir: string): Promise<void> {
  if (isWindows) {
    await execAsync(
      `powershell -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${destDir}' -Force"`,
      { timeout: 30_000 },
    );
  } else {
    await execAsync(`unzip -o "${zipPath}" -d "${destDir}"`, { timeout: 30_000 });
  }
}

// ============================================================================
// Step 3: Build Plugin
// ============================================================================

async function buildPlugin(analysis: GameAnalysis): Promise<UnitySetupStep> {
  // Check dotnet SDK
  try {
    await execAsync('dotnet --version');
  } catch {
    return {
      name: 'Build',
      status: 'error',
      message: 'dotnet SDK not found. Install from https://dot.net/download',
    };
  }

  // Check plugin source files exist
  if (!existsSync(PLUGIN_SOURCE_DIR) || !existsSync(join(PLUGIN_SOURCE_DIR, 'Protocol.cs'))) {
    return {
      name: 'Build',
      status: 'error',
      message: `Plugin source not found at ${PLUGIN_SOURCE_DIR}. Ensure OScribe is properly installed.`,
    };
  }

  // Create build directory
  const buildDir = join(BUILDS_DIR, analysis.gameName);
  mkdirSync(buildDir, { recursive: true });

  // Generate .csproj
  const csproj = generateCsproj(analysis);
  writeFileSync(join(buildDir, 'OScribeBridge.csproj'), csproj, 'utf-8');

  // Build
  try {
    const { stderr } = await execAsync('dotnet build -c Release', {
      cwd: buildDir,
      timeout: 60_000,
    });

    const dllPath = join(buildDir, 'bin', 'Release', 'net472', 'OScribeBridge.dll');
    if (!existsSync(dllPath)) {
      return {
        name: 'Build',
        status: 'error',
        message: `Build completed but DLL not found at ${dllPath}. stderr: ${stderr}`,
      };
    }

    return {
      name: 'Build',
      status: 'success',
      message: `OScribeBridge.dll built (${analysis.compilationMode} mode)`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { name: 'Build', status: 'error', message: `Build failed: ${msg}` };
  }
}

function generateCsproj(analysis: GameAnalysis): string {
  const managedDir = analysis.managedFolder;
  const bepinexCore = join(analysis.gamePath, 'BepInEx', 'core');

  const isLite = analysis.compilationMode === 'lite';
  const sourceFiles = isLite
    ? ['Protocol.cs', 'OScribeBridge.cs', 'SceneTreeWalkerLite.cs', 'TcpServerLite.cs']
    : ['Protocol.cs', 'OScribeBridge.cs', 'SceneTreeWalker.cs', 'TcpServer.cs', 'UIElementDetector.cs'];

  const compileItems = sourceFiles
    .map((f) => `    <Compile Include="${join(PLUGIN_SOURCE_DIR, f)}" />`)
    .join('\n');

  const refs: Array<{ name: string; path: string }> = [
    { name: 'BepInEx', path: join(bepinexCore, 'BepInEx.dll') },
    { name: 'UnityEngine', path: join(managedDir, 'UnityEngine.dll') },
    { name: 'UnityEngine.CoreModule', path: join(managedDir, 'UnityEngine.CoreModule.dll') },
    { name: 'UnityEngine.UI', path: join(managedDir, 'UnityEngine.UI.dll') },
    { name: 'UnityEngine.UIModule', path: join(managedDir, 'UnityEngine.UIModule.dll') },
    { name: 'UnityEngine.PhysicsModule', path: join(managedDir, 'UnityEngine.PhysicsModule.dll') },
    { name: 'UnityEngine.Physics2DModule', path: join(managedDir, 'UnityEngine.Physics2DModule.dll') },
  ];

  if (!isLite) {
    refs.push(
      { name: 'Unity.TextMeshPro', path: join(managedDir, OPTIONAL_DLLS.tmpro) },
      { name: 'Newtonsoft.Json', path: join(managedDir, OPTIONAL_DLLS.newtonsoft) },
    );
  }

  const refItems = refs
    .map(
      (r) => `    <Reference Include="${r.name}">
      <HintPath>${r.path}</HintPath>
      <Private>false</Private>
    </Reference>`,
    )
    .join('\n');

  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <TargetFramework>net472</TargetFramework>
    <AssemblyName>OScribeBridge</AssemblyName>
    <RootNamespace>OScribe.UnityBridge</RootNamespace>
    <LangVersion>latest</LangVersion>
    <EnableDefaultItems>false</EnableDefaultItems>
  </PropertyGroup>
  <ItemGroup>
${compileItems}
  </ItemGroup>
  <ItemGroup>
${refItems}
  </ItemGroup>
</Project>
`;
}

// ============================================================================
// Step 4: Deploy
// ============================================================================

async function deployPlugin(analysis: GameAnalysis): Promise<UnitySetupStep> {
  const buildDll = join(BUILDS_DIR, analysis.gameName, 'bin', 'Release', 'net472', 'OScribeBridge.dll');
  if (!existsSync(buildDll)) {
    return {
      name: 'Deploy',
      status: 'error',
      message: `Built DLL not found at ${buildDll}. Run build step first.`,
    };
  }

  // Check game running
  if (analysis.gameRunning) {
    return {
      name: 'Deploy',
      status: 'pending',
      message: `Game "${analysis.gameName}" is running. DLL is locked. Close the game first.`,
    };
  }

  // Ensure plugins dir exists
  const pluginsDir = join(analysis.gamePath, 'BepInEx', 'plugins');
  mkdirSync(pluginsDir, { recursive: true });

  const destPath = join(pluginsDir, 'OScribeBridge.dll');
  try {
    copyFileSync(buildDll, destPath);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      name: 'Deploy',
      status: 'error',
      message: `Failed to copy DLL: ${msg}. Is the game still running?`,
    };
  }

  return {
    name: 'Deploy',
    status: 'success',
    message: `Copied to ${destPath}`,
  };
}

// ============================================================================
// Helpers
// ============================================================================

function getNextStepMessage(analysis: GameAnalysis, deployResult: UnitySetupStep): string {
  if (deployResult.status === 'pending') {
    const closeVerb = isWindows ? 'Close' : 'Quit';
    return `${closeVerb} "${analysis.gameName}", then call os_unity_setup with step="deploy".`;
  }

  if (deployResult.status === 'success') {
    if (isWindows) {
      return `Launch "${analysis.gameName}". The bridge starts automatically on port 9876. Use os_screenshot to see Unity UI elements.`;
    } else {
      return [
        `Run from terminal:`,
        `  cd "${analysis.gamePath}"`,
        `  ./run_bepinex.sh`,
        ``,
        `Apple Silicon? Use: arch -x86_64 /bin/bash ./run_bepinex.sh`,
        ``,
        `Bridge starts on port 9876. Use os_screenshot to see Unity UI elements.`,
      ].join('\n');
    }
  }

  return '';
}

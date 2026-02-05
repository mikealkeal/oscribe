#!/usr/bin/env node
/**
 * OScribe Guided Installer
 *
 * Run directly:
 *   curl -fsSL https://raw.githubusercontent.com/mikealkeal/oscribe/main/scripts/install.mjs | node
 *
 * Windows (PowerShell as Admin):
 *   irm https://raw.githubusercontent.com/mikealkeal/oscribe/main/scripts/install.mjs -OutFile install.mjs; node install.mjs
 */

import { spawnSync, execSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const print = (color, text) => console.log(`${c[color]}${text}${c.reset}`);
const isWindows = process.platform === 'win32';
const isMac = process.platform === 'darwin';

// Readline for user input
const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function confirm(message, defaultYes = true) {
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = await ask(`${message} ${hint} `);
  if (answer === '') return defaultYes;
  return answer === 'y' || answer === 'yes';
}

function run(cmd, options = {}) {
  console.log(`${c.gray}$ ${cmd}${c.reset}`);
  const result = spawnSync(cmd, {
    shell: true,
    stdio: options.silent ? 'pipe' : 'inherit',
    encoding: 'utf8',
    ...options,
  });
  return result;
}

function checkCommand(cmd, args = ['--version']) {
  try {
    const result = spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: 10000,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function getCommandOutput(cmd, args = ['--version']) {
  try {
    const result = spawnSync(cmd, args, {
      encoding: 'utf8',
      timeout: 10000,
      shell: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return (result.stdout || result.stderr || '').trim();
  } catch {
    return null;
  }
}

// ============ CHECKS ============

function checkNode() {
  const version = process.versions.node;
  const major = parseInt(version.split('.')[0] || '0', 10);
  return { ok: major >= 22, version };
}

function checkPython() {
  const commands = isWindows ? ['python', 'python3', 'py'] : ['python3', 'python'];
  for (const cmd of commands) {
    const output = getCommandOutput(cmd);
    // Check for real Python version (e.g., "Python 3.12.0")
    // Exclude Windows Store redirect message ("Python est introuvable" / "Python was not found")
    if (output && /Python \d+\.\d+/.test(output)) {
      return { ok: true, version: output.split('\n')[0] };
    }
  }
  return { ok: false };
}

function checkBuildTools() {
  if (isWindows) {
    const vsPaths = [
      'C:\\Program Files\\Microsoft Visual Studio',
      'C:\\Program Files (x86)\\Microsoft Visual Studio',
      'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools',
      'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools',
      'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
    ];
    for (const vsPath of vsPaths) {
      if (existsSync(vsPath)) {
        return { ok: true, path: vsPath };
      }
    }
    return { ok: false };
  } else if (isMac) {
    const result = spawnSync('xcode-select', ['-p'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    if (result.status === 0) {
      return { ok: true, path: result.stdout.trim() };
    }
    return { ok: false };
  }
  // Linux - assume gcc is needed
  return { ok: checkCommand('gcc') || checkCommand('g++') };
}

// ============ INSTALLERS ============

async function installPython() {
  print('cyan', '\n📦 Installing Python...\n');

  if (isWindows) {
    // Try winget first
    if (checkCommand('winget', ['--version'])) {
      print('gray', 'Using winget to install Python...');
      const result = run('winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements');
      if (result.status === 0) {
        print('green', '✓ Python installed via winget');
        print('yellow', '\n⚠️  Please restart your terminal/PowerShell to use Python.');
        return true;
      }
    }

    // Fallback to manual download
    print('yellow', '\nAutomatic installation failed. Please install Python manually:');
    print('cyan', '  1. Go to https://www.python.org/downloads/');
    print('cyan', '  2. Download Python 3.12+');
    print('yellow', '  3. IMPORTANT: Check "Add Python to PATH" during installation!');
    print('cyan', '  4. Restart your terminal after installation');

    await ask('\nPress Enter after installing Python...');
    return checkPython().ok;
  } else if (isMac) {
    // Try Homebrew
    if (checkCommand('brew', ['--version'])) {
      print('gray', 'Using Homebrew to install Python...');
      const result = run('brew install python@3.12');
      if (result.status === 0) {
        print('green', '✓ Python installed via Homebrew');
        return true;
      }
    }

    print('yellow', '\nPlease install Python manually:');
    print('cyan', '  brew install python3');
    print('gray', '  or download from https://www.python.org/downloads/');

    await ask('\nPress Enter after installing Python...');
    return checkPython().ok;
  } else {
    // Linux
    print('yellow', '\nPlease install Python using your package manager:');
    print('cyan', '  Ubuntu/Debian: sudo apt install python3 python3-pip');
    print('cyan', '  Fedora: sudo dnf install python3');
    print('cyan', '  Arch: sudo pacman -S python');

    await ask('\nPress Enter after installing Python...');
    return checkPython().ok;
  }
}

async function installBuildTools() {
  print('cyan', '\n📦 Installing Build Tools...\n');

  if (isWindows) {
    print('yellow', 'Visual Studio Build Tools are required for native modules.\n');

    // Check if running as admin
    const isAdmin = (() => {
      try {
        execSync('net session', { stdio: 'pipe' });
        return true;
      } catch {
        return false;
      }
    })();

    if (!isAdmin) {
      print('red', '⚠️  Administrator privileges required for build tools installation.');
      print('yellow', '\nPlease either:');
      print('cyan', '  1. Run this script as Administrator (right-click PowerShell → Run as Administrator)');
      print('cyan', '  2. Or install manually from:');
      print('cyan', '     https://visualstudio.microsoft.com/visual-cpp-build-tools/');
      print('gray', '     Select "Desktop development with C++" workload');

      await ask('\nPress Enter after installing build tools...');
      return checkBuildTools().ok;
    }

    // Try npm windows-build-tools (deprecated but still works)
    print('gray', 'Attempting to install via npm...');
    const result = run('npm install -g windows-build-tools', { timeout: 600000 });

    if (result.status === 0) {
      print('green', '✓ Visual Studio Build Tools installed');
      return true;
    }

    // Fallback instructions
    print('yellow', '\nAutomatic installation failed. Please install manually:');
    print('cyan', '  1. Go to https://visualstudio.microsoft.com/visual-cpp-build-tools/');
    print('cyan', '  2. Download and run the installer');
    print('cyan', '  3. Select "Desktop development with C++" workload');
    print('cyan', '  4. Complete the installation');

    await ask('\nPress Enter after installing build tools...');
    return checkBuildTools().ok;
  } else if (isMac) {
    print('gray', 'Installing Xcode Command Line Tools...');
    run('xcode-select --install');

    print('yellow', '\nA dialog may have appeared to install Xcode CLT.');
    print('gray', 'Complete the installation and press Enter when done.');

    await ask('\nPress Enter after installation completes...');
    return checkBuildTools().ok;
  } else {
    // Linux
    print('yellow', '\nPlease install build essentials:');
    print('cyan', '  Ubuntu/Debian: sudo apt install build-essential');
    print('cyan', '  Fedora: sudo dnf groupinstall "Development Tools"');
    print('cyan', '  Arch: sudo pacman -S base-devel');

    await ask('\nPress Enter after installing build tools...');
    return checkBuildTools().ok;
  }
}

// ============ MAIN ============

async function main() {
  console.log();
  print('bold', '╔════════════════════════════════════════════════════════╗');
  print('bold', '║           🚀 OScribe Guided Installer                  ║');
  print('bold', '╚════════════════════════════════════════════════════════╝');
  console.log();

  // Step 1: Check Node.js
  print('bold', '📋 Step 1/4: Checking Node.js...');
  const node = checkNode();
  if (node.ok) {
    print('green', `   ✓ Node.js ${node.version} - OK`);
  } else {
    print('red', `   ✗ Node.js ${node.version} - Requires v22+`);
    print('yellow', '\n⚠️  Please install Node.js 22+ first:');
    print('cyan', '   https://nodejs.org/');
    print('gray', '\nRe-run this installer after upgrading Node.js.');
    rl.close();
    process.exit(1);
  }

  // Step 2: Check/Install Python
  console.log();
  print('bold', '📋 Step 2/4: Checking Python...');
  let python = checkPython();
  if (python.ok) {
    print('green', `   ✓ ${python.version} - OK`);
  } else {
    print('red', '   ✗ Python not found');

    if (await confirm('\n   Install Python now?')) {
      const installed = await installPython();
      if (!installed) {
        print('red', '\n   ✗ Python installation failed. Please install manually and retry.');
        rl.close();
        process.exit(1);
      }
    } else {
      print('yellow', '\n   Skipped. Installation may fail without Python.');
    }
  }

  // Step 3: Check/Install Build Tools
  console.log();
  print('bold', '📋 Step 3/4: Checking Build Tools...');
  let buildTools = checkBuildTools();
  if (buildTools.ok) {
    print('green', `   ✓ Build tools found${buildTools.path ? ` (${buildTools.path})` : ''} - OK`);
  } else {
    print('red', `   ✗ Build tools not found`);

    if (await confirm('\n   Install build tools now?')) {
      const installed = await installBuildTools();
      if (!installed) {
        print('red', '\n   ✗ Build tools installation failed. Please install manually and retry.');
        rl.close();
        process.exit(1);
      }
    } else {
      print('yellow', '\n   Skipped. Installation may fail without build tools.');
    }
  }

  // Step 4: Install OScribe
  console.log();
  print('bold', '📋 Step 4/4: Installing OScribe...');

  if (await confirm('\n   Install OScribe globally now?')) {
    console.log();
    const result = run('npm install -g oscribe');

    if (result.status === 0) {
      console.log();
      print('green', '╔════════════════════════════════════════════════════════╗');
      print('green', '║          ✅ OScribe installed successfully!            ║');
      print('green', '╚════════════════════════════════════════════════════════╝');
      console.log();
      print('gray', 'Next steps:');
      print('cyan', '  oscribe --help          # See all commands');
      print('cyan', '  oscribe serve           # Start MCP server');
      console.log();
    } else {
      console.log();
      print('red', '╔════════════════════════════════════════════════════════╗');
      print('red', '║          ❌ Installation failed                        ║');
      print('red', '╚════════════════════════════════════════════════════════╝');
      console.log();
      print('yellow', 'Troubleshooting:');
      print('gray', '  1. Make sure all prerequisites are installed');
      print('gray', '  2. Try: npm cache clean --force');
      print('gray', '  3. Retry: npm install -g oscribe');
      print('gray', '  4. Check: https://github.com/mikealkeal/oscribe/issues');
      console.log();
    }
  } else {
    console.log();
    print('gray', 'Skipped. You can install later with:');
    print('cyan', '  npm install -g oscribe');
    console.log();
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});

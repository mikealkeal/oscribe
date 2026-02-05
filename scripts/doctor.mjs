#!/usr/bin/env node
/**
 * OScribe Doctor - Standalone prerequisite checker
 *
 * Run directly without installation:
 *   curl -fsSL https://raw.githubusercontent.com/mikealkeal/oscribe/main/scripts/doctor.mjs | node
 *
 * Or on Windows (PowerShell):
 *   irm https://raw.githubusercontent.com/mikealkeal/oscribe/main/scripts/doctor.mjs | node
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

// ANSI colors (works in most terminals)
const colors = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

const c = (color, text) => `${colors[color]}${text}${colors.reset}`;

console.log();
console.log(c('bold', '🩺 OScribe Doctor'));
console.log(c('gray', 'Checking system prerequisites...\n'));

const checks = [];
let hasErrors = false;
let hasWarnings = false;

// Check Node.js version
const nodeVersion = process.versions.node;
const nodeMajor = parseInt(nodeVersion.split('.')[0] || '0', 10);
if (nodeMajor >= 22) {
  checks.push({ name: 'Node.js', status: 'ok', message: `v${nodeVersion}` });
} else {
  checks.push({
    name: 'Node.js',
    status: 'error',
    message: `v${nodeVersion} (requires 22+)`,
    fix: 'Download Node.js 22+ from https://nodejs.org/',
  });
}

// Check Python
function checkPython() {
  const commands = process.platform === 'win32'
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];

  for (const cmd of commands) {
    try {
      const result = spawnSync(cmd, ['--version'], {
        encoding: 'utf8',
        timeout: 5000,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      const output = (result.stdout || result.stderr || '').trim();
      // Check for real Python version (e.g., "Python 3.12.0")
      // Exclude Windows Store redirect message
      if (result.status === 0 && /Python \d+\.\d+/.test(output)) {
        return { name: 'Python', status: 'ok', message: output.split('\n')[0] };
      }
    } catch {
      // Try next command
    }
  }

  const fix = process.platform === 'win32'
    ? `Download Python from https://www.python.org/downloads/
   ${c('yellow', 'IMPORTANT')}: Check "Add Python to PATH" during installation`
    : 'Install Python: brew install python3 (macOS) or apt install python3 (Linux)';

  return { name: 'Python', status: 'error', message: 'Not found in PATH', fix };
}
checks.push(checkPython());

// Platform-specific checks
if (process.platform === 'win32') {
  // Check Visual Studio Build Tools
  const vsPaths = [
    'C:\\Program Files\\Microsoft Visual Studio',
    'C:\\Program Files (x86)\\Microsoft Visual Studio',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional',
  ];

  let vsFound = false;
  for (const vsPath of vsPaths) {
    if (existsSync(vsPath)) {
      vsFound = true;
      checks.push({ name: 'VS Build Tools', status: 'ok', message: 'Found' });
      break;
    }
  }

  if (!vsFound) {
    // Check via npm config
    try {
      const result = spawnSync('npm', ['config', 'get', 'msvs_version'], {
        encoding: 'utf8',
        timeout: 5000,
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      if (result.status === 0 && result.stdout && !result.stdout.includes('undefined')) {
        vsFound = true;
        checks.push({ name: 'VS Build Tools', status: 'ok', message: `MSVS ${result.stdout.trim()}` });
      }
    } catch {
      // Continue
    }
  }

  if (!vsFound) {
    checks.push({
      name: 'VS Build Tools',
      status: 'error',
      message: 'Not found',
      fix: `Install Visual Studio Build Tools:
   Option 1: npm install -g windows-build-tools
   Option 2: https://visualstudio.microsoft.com/visual-cpp-build-tools/
             Select "Desktop development with C++" workload`,
    });
  }
} else if (process.platform === 'darwin') {
  // Check Xcode Command Line Tools
  try {
    const result = spawnSync('xcode-select', ['-p'], {
      encoding: 'utf8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    if (result.status === 0 && result.stdout) {
      checks.push({ name: 'Xcode CLI', status: 'ok', message: result.stdout.trim() });
    } else {
      throw new Error('Not installed');
    }
  } catch {
    checks.push({
      name: 'Xcode CLI',
      status: 'error',
      message: 'Not installed',
      fix: 'Run: xcode-select --install',
    });
  }
}

// Display results
for (const check of checks) {
  let icon, color;
  switch (check.status) {
    case 'ok':
      icon = '✓';
      color = 'green';
      break;
    case 'warning':
      icon = '⚠';
      color = 'yellow';
      hasWarnings = true;
      break;
    case 'error':
      icon = '✗';
      color = 'red';
      hasErrors = true;
      break;
  }
  console.log(`${c(color, icon)} ${c('bold', check.name)}: ${check.message}`);
}

console.log();

// Show fixes if there are issues
if (hasErrors || hasWarnings) {
  console.log(c('yellow', "Issues found. Here's how to fix them:\n"));

  for (const check of checks) {
    if (check.fix && check.status === 'error') {
      console.log(c('bold', `📌 ${check.name}:`));
      console.log(c('gray', `   ${check.fix.replace(/\n/g, '\n   ')}`));
      console.log();
    }
  }

  if (hasErrors) {
    console.log(c('red', '⚠️  Please fix the errors above before installing OScribe.\n'));
    console.log('After fixing, install with:');
    console.log(c('cyan', '  npm install -g oscribe\n'));
    process.exit(1);
  }
} else {
  console.log(c('green', '✅ All prerequisites met!\n'));
  console.log('You can install OScribe with:');
  console.log(c('cyan', '  npm install -g oscribe\n'));
}

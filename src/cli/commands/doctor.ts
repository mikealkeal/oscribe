/**
 * doctor command - Check system prerequisites and guide installation
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { execSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

interface CheckResult {
  name: string;
  status: 'ok' | 'warning' | 'error';
  message: string;
  fix?: string;
}

/**
 * Check Node.js version
 */
function checkNodeVersion(): CheckResult {
  const version = process.versions.node;
  const major = parseInt(version.split('.')[0] ?? '0', 10);

  if (major >= 22) {
    return {
      name: 'Node.js',
      status: 'ok',
      message: `v${version}`,
    };
  }

  return {
    name: 'Node.js',
    status: 'error',
    message: `v${version} (requires 22+)`,
    fix: 'Download Node.js 22+ from https://nodejs.org/',
  };
}

/**
 * Check Python installation
 */
function checkPython(): CheckResult {
  const commands = process.platform === 'win32' ? ['python', 'python3', 'py'] : ['python3', 'python'];

  for (const cmd of commands) {
    try {
      const result = spawnSync(cmd, ['--version'], {
        encoding: 'utf8',
        timeout: 5000,
        shell: true,
      });

      const output = (result.stdout || result.stderr || '').trim();
      // Check for real Python version (e.g., "Python 3.12.0")
      // Exclude Windows Store redirect message
      if (result.status === 0 && /Python \d+\.\d+/.test(output)) {
        return {
          name: 'Python',
          status: 'ok',
          message: output.split('\n')[0] ?? output,
        };
      }
    } catch {
      // Try next command
    }
  }

  const fix =
    process.platform === 'win32'
      ? 'Download Python from https://www.python.org/downloads/\nIMPORTANT: Check "Add Python to PATH" during installation'
      : 'Install Python: brew install python3 (macOS) or apt install python3 (Linux)';

  return {
    name: 'Python',
    status: 'error',
    message: 'Not found in PATH',
    fix,
  };
}

/**
 * Check Visual Studio Build Tools (Windows)
 */
function checkVSBuildTools(): CheckResult {
  // Check common Visual Studio paths
  const vsPaths = [
    'C:\\Program Files\\Microsoft Visual Studio',
    'C:\\Program Files (x86)\\Microsoft Visual Studio',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2022\\BuildTools',
    'C:\\Program Files (x86)\\Microsoft Visual Studio\\2019\\BuildTools',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Community',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Professional',
    'C:\\Program Files\\Microsoft Visual Studio\\2022\\Enterprise',
  ];

  for (const vsPath of vsPaths) {
    if (existsSync(vsPath)) {
      return {
        name: 'VS Build Tools',
        status: 'ok',
        message: 'Found',
      };
    }
  }

  // Check via npm config
  try {
    const result = spawnSync('npm', ['config', 'get', 'msvs_version'], {
      encoding: 'utf8',
      timeout: 5000,
      shell: true,
    });

    if (result.status === 0 && result.stdout && !result.stdout.includes('undefined')) {
      return {
        name: 'VS Build Tools',
        status: 'ok',
        message: `MSVS ${result.stdout.trim()}`,
      };
    }
  } catch {
    // Continue to error
  }

  return {
    name: 'VS Build Tools',
    status: 'error',
    message: 'Not found',
    fix: `Install Visual Studio Build Tools:
  Option 1 (npm): npm install -g windows-build-tools
  Option 2 (manual): https://visualstudio.microsoft.com/visual-cpp-build-tools/
    → Select "Desktop development with C++" workload`,
  };
}

/**
 * Check Xcode Command Line Tools (macOS)
 */
function checkXcode(): CheckResult {
  try {
    const result = spawnSync('xcode-select', ['-p'], {
      encoding: 'utf8',
      timeout: 5000,
    });

    if (result.status === 0 && result.stdout) {
      return {
        name: 'Xcode CLI',
        status: 'ok',
        message: result.stdout.trim(),
      };
    }
  } catch {
    // Not installed
  }

  return {
    name: 'Xcode CLI',
    status: 'error',
    message: 'Not installed',
    fix: 'Run: xcode-select --install',
  };
}

/**
 * Check if robotjs can be loaded
 */
function checkRobotjs(): CheckResult {
  try {
    // Try to require robotjs
    require.resolve('robotjs');
    return {
      name: 'robotjs',
      status: 'ok',
      message: 'Installed and working',
    };
  } catch {
    return {
      name: 'robotjs',
      status: 'warning',
      message: 'Not loaded (may need rebuild)',
      fix: 'Run: npm rebuild robotjs',
    };
  }
}

/**
 * Check npm global prefix
 */
function checkNpmGlobal(): CheckResult {
  try {
    const result = spawnSync('npm', ['config', 'get', 'prefix'], {
      encoding: 'utf8',
      timeout: 5000,
      shell: true,
    });

    if (result.status === 0 && result.stdout) {
      const prefix = result.stdout.trim();
      return {
        name: 'npm prefix',
        status: 'ok',
        message: prefix,
      };
    }
  } catch {
    // Ignore
  }

  return {
    name: 'npm prefix',
    status: 'warning',
    message: 'Could not determine',
  };
}

export function doctorCommand(): Command {
  return new Command('doctor')
    .description('Check system prerequisites for OScribe installation')
    .option('--fix', 'Show detailed fix instructions')
    .action(async (options) => {
      console.log();
      console.log(chalk.bold('🩺 OScribe Doctor'));
      console.log(chalk.gray('Checking system prerequisites...\n'));

      const checks: CheckResult[] = [];

      // Always check
      checks.push(checkNodeVersion());
      checks.push(checkPython());

      // Platform-specific checks
      if (process.platform === 'win32') {
        checks.push(checkVSBuildTools());
      } else if (process.platform === 'darwin') {
        checks.push(checkXcode());
      }

      // Check npm
      checks.push(checkNpmGlobal());

      // Try to check robotjs (only if already installed)
      try {
        checks.push(checkRobotjs());
      } catch {
        // Skip if not in a context where robotjs would be available
      }

      // Display results
      let hasErrors = false;
      let hasWarnings = false;

      for (const check of checks) {
        let icon: string;
        let color: typeof chalk.green;

        switch (check.status) {
          case 'ok':
            icon = '✓';
            color = chalk.green;
            break;
          case 'warning':
            icon = '⚠';
            color = chalk.yellow;
            hasWarnings = true;
            break;
          case 'error':
            icon = '✗';
            color = chalk.red;
            hasErrors = true;
            break;
        }

        console.log(`${color(icon)} ${chalk.bold(check.name)}: ${check.message}`);
      }

      console.log();

      // Show fixes if there are issues
      if (hasErrors || hasWarnings) {
        console.log(chalk.yellow.bold('Issues found. Here\'s how to fix them:\n'));

        for (const check of checks) {
          if (check.fix && (check.status === 'error' || (options.fix && check.status === 'warning'))) {
            console.log(chalk.bold(`📌 ${check.name}:`));
            console.log(chalk.gray(check.fix));
            console.log();
          }
        }

        if (hasErrors) {
          console.log(chalk.red.bold('⚠️  Please fix the errors above before installing OScribe.'));
          console.log();
          console.log('After fixing, retry installation:');
          console.log(chalk.cyan('  npm install -g oscribe'));
        }
      } else {
        console.log(chalk.green.bold('✅ All prerequisites met!'));
        console.log();
        console.log('You can install OScribe with:');
        console.log(chalk.cyan('  npm install -g oscribe'));
      }

      console.log();

      // Exit with error code if there are errors
      if (hasErrors) {
        process.exit(1);
      }
    });
}

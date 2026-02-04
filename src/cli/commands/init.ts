/**
 * init command - Setup OScribe
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { createInterface } from 'node:readline';
import { ensureConfigDir, getConfigPath, saveConfig } from '../../config/index.js';
import { isNvdaInstalled, initNvda } from '../../core/nvda.js';

/**
 * Simple yes/no prompt using readline
 */
async function confirm(message: string, defaultValue = true): Promise<boolean> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const hint = defaultValue ? '[Y/n]' : '[y/N]';

  return new Promise((resolve) => {
    rl.question(`${message} ${hint} `, (answer) => {
      rl.close();
      const normalized = answer.trim().toLowerCase();
      if (normalized === '') {
        resolve(defaultValue);
      } else {
        resolve(normalized === 'y' || normalized === 'yes');
      }
    });
  });
}

export function initCommand(): Command {
  return new Command('init').description('Initialize OScribe configuration').action(async () => {
    const spinner = ora('Initializing OScribe...').start();

    try {
      ensureConfigDir();
      saveConfig({});

      spinner.succeed(chalk.green('OScribe initialized successfully!'));
      console.log();
      console.log(`Config file: ${chalk.cyan(getConfigPath())}`);

      // Windows-specific: offer NVDA installation for Electron accessibility
      if (process.platform === 'win32' && !isNvdaInstalled()) {
        console.log();
        console.log(chalk.yellow('📢 Windows detected'));
        console.log(chalk.gray('NVDA screen reader is needed to automate Electron apps (VS Code, Slack, Discord, etc.)'));
        console.log(chalk.gray('Without NVDA, these apps show only 3-5 UI elements instead of 100+.'));
        console.log();

        const installNvda = await confirm('Install NVDA portable for Electron accessibility? (~40MB)', true);

        if (installNvda) {
          const nvdaSpinner = ora('Downloading NVDA portable...').start();
          try {
            const success = await initNvda(true);
            if (success) {
              nvdaSpinner.succeed(chalk.green('NVDA portable installed and configured (silent mode)'));
            } else {
              nvdaSpinner.fail(chalk.yellow('NVDA installation failed - you can retry with: oscribe nvda install'));
            }
          } catch {
            nvdaSpinner.fail(chalk.yellow('NVDA installation failed'));
            console.log(chalk.gray(`You can retry later with: oscribe nvda install`));
          }
        } else {
          console.log(chalk.gray('Skipped. You can install later with: oscribe nvda install'));
        }
      }

      console.log();
      console.log('Next steps:');
      console.log(`  ${chalk.yellow('oscribe login')}     Configure API key`);
      console.log(`  ${chalk.yellow('oscribe --help')}    See all commands`);
    } catch (error) {
      spinner.fail(chalk.red('Failed to initialize OScribe'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
}

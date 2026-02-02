/**
 * nvda command - Manage NVDA screen reader for Electron accessibility
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  getNvdaStatus,
  initNvda,
  startNvda,
  stopNvda,
  getPaths,
} from '../../core/nvda.js';

export function nvdaCommand(): Command {
  const cmd = new Command('nvda')
    .description('Manage NVDA screen reader for Electron app accessibility');

  cmd
    .command('status')
    .description('Show NVDA installation and running status')
    .action(async () => {
      const spinner = ora('Checking NVDA status...').start();

      try {
        const status = await getNvdaStatus();
        spinner.stop();

        console.log();
        console.log(chalk.bold('NVDA Status'));
        console.log('─'.repeat(40));
        console.log(
          `Installed:     ${status.installed ? chalk.green('Yes') : chalk.yellow('No')}`
        );
        if (status.version) {
          console.log(`Version:       ${chalk.cyan(status.version)}`);
        }
        console.log(
          `Silent config: ${status.configValid ? chalk.green('Valid') : chalk.yellow('Not configured')}`
        );
        console.log(
          `Running:       ${status.running ? chalk.green('Yes') : chalk.gray('No')}`
        );
        if (status.pid) {
          console.log(`PID:           ${status.pid}`);
        }
        console.log();
        console.log(`Location: ${chalk.gray(getPaths().nvdaDir)}`);
      } catch (error) {
        spinner.fail(chalk.red('Failed to check NVDA status'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  cmd
    .command('install')
    .description('Download and configure NVDA portable')
    .action(async () => {
      if (process.platform !== 'win32') {
        console.log(chalk.yellow('NVDA is only available on Windows'));
        return;
      }

      const spinner = ora('Initializing NVDA...').start();

      try {
        const status = await getNvdaStatus();

        if (status.installed && status.configValid) {
          spinner.succeed(chalk.green('NVDA is already installed and configured'));
          return;
        }

        if (!status.installed) {
          spinner.text = 'Downloading NVDA portable (~40MB)...';
        }

        const success = await initNvda(true); // forceDownload=true for CLI

        if (success) {
          spinner.succeed(chalk.green('NVDA portable installed and configured'));
          console.log();
          console.log(`Location: ${chalk.cyan(getPaths().nvdaDir)}`);
          console.log();
          console.log('NVDA will start automatically when accessing Electron apps.');
        } else {
          spinner.fail(chalk.red('Failed to install NVDA'));
          process.exit(1);
        }
      } catch (error) {
        spinner.fail(chalk.red('Failed to install NVDA'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  cmd
    .command('start')
    .description('Start NVDA in silent mode')
    .action(async () => {
      if (process.platform !== 'win32') {
        console.log(chalk.yellow('NVDA is only available on Windows'));
        return;
      }

      const spinner = ora('Starting NVDA...').start();

      try {
        const success = await startNvda();

        if (success) {
          spinner.succeed(chalk.green('NVDA started in silent mode'));
        } else {
          spinner.fail(chalk.red('Failed to start NVDA'));
          process.exit(1);
        }
      } catch (error) {
        spinner.fail(chalk.red('Failed to start NVDA'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  cmd
    .command('stop')
    .description('Stop NVDA')
    .action(async () => {
      if (process.platform !== 'win32') {
        console.log(chalk.yellow('NVDA is only available on Windows'));
        return;
      }

      const spinner = ora('Stopping NVDA...').start();

      try {
        const success = await stopNvda();

        if (success) {
          spinner.succeed(chalk.green('NVDA stopped'));
        } else {
          spinner.fail(chalk.red('Failed to stop NVDA'));
          process.exit(1);
        }
      } catch (error) {
        spinner.fail(chalk.red('Failed to stop NVDA'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Default action: show status
  cmd.action(async () => {
    const status = await getNvdaStatus();

    console.log();
    console.log(chalk.bold('NVDA Screen Reader'));
    console.log('─'.repeat(40));
    console.log(
      `Status: ${status.installed ? (status.running ? chalk.green('Running') : chalk.gray('Installed')) : chalk.yellow('Not installed')}`
    );
    console.log();
    console.log('Commands:');
    console.log(`  ${chalk.yellow('oscribe nvda status')}   Show detailed status`);
    console.log(`  ${chalk.yellow('oscribe nvda install')}  Download NVDA portable`);
    console.log(`  ${chalk.yellow('oscribe nvda start')}    Start NVDA silently`);
    console.log(`  ${chalk.yellow('oscribe nvda stop')}     Stop NVDA`);
    console.log();
    console.log(
      chalk.gray('NVDA enables full UI element detection in Electron apps.')
    );
  });

  return cmd;
}

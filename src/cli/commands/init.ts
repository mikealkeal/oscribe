/**
 * init command - Setup OSbot
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { ensureConfigDir, getConfigPath, saveConfig } from '../../config/index.js';

export function initCommand(): Command {
  return new Command('init')
    .description('Initialize OSbot configuration')
    .action(async () => {
      const spinner = ora('Initializing OSbot...').start();

      try {
        ensureConfigDir();
        saveConfig({});

        spinner.succeed(chalk.green('OSbot initialized successfully!'));
        console.log();
        console.log(`Config file: ${chalk.cyan(getConfigPath())}`);
        console.log();
        console.log('Next steps:');
        console.log(`  ${chalk.yellow('osbot login')}     Configure API key`);
        console.log(`  ${chalk.yellow('osbot --help')}    See all commands`);
      } catch (error) {
        spinner.fail(chalk.red('Failed to initialize OSbot'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

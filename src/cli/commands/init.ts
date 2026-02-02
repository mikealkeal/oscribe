/**
 * init command - Setup OScribe
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { ensureConfigDir, getConfigPath, saveConfig } from '../../config/index.js';

export function initCommand(): Command {
  return new Command('init').description('Initialize OScribe configuration').action(async () => {
    const spinner = ora('Initializing OScribe...').start();

    try {
      ensureConfigDir();
      saveConfig({});

      spinner.succeed(chalk.green('OScribe initialized successfully!'));
      console.log();
      console.log(`Config file: ${chalk.cyan(getConfigPath())}`);
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

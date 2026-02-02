/**
 * login command - API key authentication
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'node:readline';
import { saveConfig, getApiKey } from '../../config/index.js';

export function loginCommand(): Command {
  return new Command('login')
    .description('Configure Anthropic API key')
    .option('--key <apiKey>', 'API key')
    .option('--status', 'Check login status')
    .option('--logout', 'Remove stored API key')
    .action(async (options: { key?: string; status?: boolean; logout?: boolean }) => {
      // Check status
      if (options.status) {
        const key = getApiKey();
        if (key) {
          console.log(chalk.green('✓ API key configured'));
          console.log(chalk.gray(`  Key: ${key.slice(0, 12)}...`));
        } else {
          console.log(chalk.yellow('No API key configured.'));
          console.log('Run: oscribe login --key sk-ant-xxx');
        }
        return;
      }

      // Logout
      if (options.logout) {
        saveConfig({ apiKey: undefined });
        console.log(chalk.green('API key removed.'));
        return;
      }

      let apiKey = options.key;

      // If no key provided, prompt for it
      if (!apiKey) {
        const existing = getApiKey();
        if (existing) {
          console.log(chalk.green('API key already configured.'));
          console.log('Use --key to update or --logout to remove.');
          return;
        }

        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        apiKey = await new Promise<string>((resolve) => {
          rl.question('Enter your Anthropic API key: ', (answer) => {
            rl.close();
            resolve(answer.trim());
          });
        });
      }

      if (!apiKey) {
        console.error(chalk.red('No API key provided.'));
        process.exit(1);
      }

      if (!apiKey.startsWith('sk-ant-')) {
        console.error(chalk.red('Invalid API key format. Should start with "sk-ant-"'));
        process.exit(1);
      }

      saveConfig({ apiKey });
      console.log(chalk.green('API key saved!'));
      console.log();
      console.log('Try:');
      console.log(`  ${chalk.cyan('oscribe screenshot --describe')}`);
      console.log(`  ${chalk.cyan('oscribe click "the Start button"')}`);
    });
}

/**
 * login command - Configure API key
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { saveConfig, getApiKey } from '../../config/index.js';
import * as readline from 'node:readline';

export function loginCommand(): Command {
  return new Command('login')
    .description('Configure Anthropic API key')
    .option('--key <apiKey>', 'API key (or set ANTHROPIC_API_KEY env var)')
    .action(async (options: { key?: string }) => {
      let apiKey = options.key;

      if (!apiKey) {
        // Check if already configured
        const existing = getApiKey();
        if (existing) {
          console.log(chalk.green('API key already configured.'));
          console.log('Use --key to update it.');
          return;
        }

        // Prompt for API key
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

      if (!apiKey || !apiKey.startsWith('sk-ant-')) {
        console.error(chalk.red('Invalid API key. Should start with "sk-ant-"'));
        process.exit(1);
      }

      saveConfig({ apiKey });
      console.log(chalk.green('API key saved successfully!'));
    });
}

/**
 * killswitch command - Manage the kill switch for automation safety
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const OSCRIBE_DIR = join(homedir(), '.oscribe');
const RESUME_FILE = join(OSCRIBE_DIR, 'killswitch-resume');

export function killswitchCommand(): Command {
  const cmd = new Command('killswitch')
    .description('Manage the kill switch for automation safety');

  cmd
    .command('reset')
    .alias('resume')
    .description('Reset the kill switch to allow automation to continue')
    .action(() => {
      try {
        // Ensure .oscribe directory exists
        if (!existsSync(OSCRIBE_DIR)) {
          mkdirSync(OSCRIBE_DIR, { recursive: true });
        }

        // Create the resume signal file with timestamp
        writeFileSync(RESUME_FILE, Date.now().toString(), 'utf-8');

        console.log();
        console.log(chalk.green('Kill switch reset signal sent.'));
        console.log(chalk.gray('The MCP server will resume automation on the next action.'));
        console.log();
      } catch (error) {
        console.error(chalk.red('Failed to reset kill switch'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  cmd
    .command('status')
    .description('Show kill switch configuration')
    .action(async () => {
      // Dynamic import to avoid loading config at CLI startup
      const { loadConfig } = await import('../../config/index.js');
      const config = loadConfig();
      const { killSwitch } = config;

      console.log();
      console.log(chalk.bold('Kill Switch Configuration'));
      console.log('─'.repeat(40));
      console.log(
        `Enabled:           ${killSwitch.enabled ? chalk.green('Yes') : chalk.yellow('No')}`
      );
      console.log(
        `Movement threshold: ${chalk.cyan(killSwitch.movementThreshold + 'px')}`
      );
      console.log(
        `Cooldown:          ${chalk.cyan(killSwitch.cooldownMs + 'ms')}`
      );
      console.log();
      console.log(chalk.gray('The kill switch stops automation when you move the mouse.'));
      console.log(chalk.gray('Use "oscribe killswitch reset" to resume after a stop.'));
    });

  // Default action: show help
  cmd.action(() => {
    console.log();
    console.log(chalk.bold('Kill Switch'));
    console.log('─'.repeat(40));
    console.log('Safety feature that stops automation when you move the mouse.');
    console.log();
    console.log('Commands:');
    console.log(`  ${chalk.yellow('oscribe killswitch reset')}   Reset and allow automation to continue`);
    console.log(`  ${chalk.yellow('oscribe killswitch status')}  Show current configuration`);
    console.log();
  });

  return cmd;
}

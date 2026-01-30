/**
 * type command - Type text
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { typeText } from '../../core/input.js';

export function typeCommand(): Command {
  return new Command('type')
    .description('Type text using the keyboard')
    .argument('<text>', 'Text to type')
    .option('-d, --delay <ms>', 'Delay between keystrokes in ms', '0')
    .option('--dry-run', 'Show what would be typed without typing')
    .action(async (text: string, options: { delay: string; dryRun?: boolean }) => {
      try {
        const delay = parseInt(options.delay, 10);

        if (options.dryRun) {
          console.log(chalk.yellow(`[DRY RUN] Would type: "${text}"`));
          return;
        }

        await typeText(text, { delay });
        console.log(chalk.green(`Typed: "${text}"`));
      } catch (error) {
        console.error(chalk.red('Failed to type'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

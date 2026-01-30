/**
 * hotkey command - Press keyboard shortcuts
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { hotkey } from '../../core/input.js';

export function hotkeyCommand(): Command {
  return new Command('hotkey')
    .description('Press a keyboard shortcut (e.g., ctrl+a, ctrl+c, alt+tab)')
    .argument('<keys>', 'Keys to press (e.g., "ctrl+a", "ctrl+shift+esc")')
    .option('--dry-run', 'Simulate without executing')
    .option('-v, --verbose', 'Verbose output')
    .action(async (keys: string, options: { dryRun?: boolean; verbose?: boolean }) => {
      try {
        const keyList = keys.split('+').map((k) => k.trim());

        if (options.verbose) {
          console.log(`Pressing: ${keyList.join('+')}`);
        }

        if (options.dryRun) {
          console.log(chalk.yellow(`[DRY RUN] Would press: ${keys}`));
          return;
        }

        await hotkey(keyList);
        console.log(chalk.green(`Pressed: ${keys}`));
      } catch (error) {
        console.error(chalk.red('Failed to press hotkey'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

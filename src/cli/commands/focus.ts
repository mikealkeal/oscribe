/**
 * focus command - Focus a window
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { focusWindow } from '../../core/windows.js';

export function focusCommand(): Command {
  return new Command('focus')
    .description('Focus a window by title or app name')
    .argument('<window>', 'Window title or app name')
    .action(async (window: string) => {
      try {
        const success = await focusWindow(window);

        if (success) {
          console.log(chalk.green(`Focused: ${window}`));
        } else {
          console.log(chalk.yellow(`Could not focus: ${window} (feature not yet implemented)`));
        }
      } catch (error) {
        console.error(chalk.red('Failed to focus window'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

/**
 * windows command - List windows
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { listWindows } from '../../core/windows.js';

export function windowsCommand(): Command {
  return new Command('windows').description('List open windows').action(async () => {
    try {
      const windows = await listWindows();

      if (windows.length === 0) {
        console.log(chalk.yellow('No windows found (feature not yet implemented)'));
        return;
      }

      console.log(chalk.cyan('Open windows:'));
      windows.forEach((w) => {
        console.log(`  ${w.title} ${w.app ? chalk.gray(`(${w.app})`) : ''}`);
      });
    } catch (error) {
      console.error(chalk.red('Failed to list windows'));
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  });
}

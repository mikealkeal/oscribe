/**
 * tokens command - Display token usage statistics
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { getSessionStats, getDailyStats, formatStats, resetSession } from '../../core/token-tracker.js';

export function tokensCommand(): Command {
  const cmd = new Command('tokens')
    .description('Display token usage statistics')
    .option('-d, --daily [date]', 'Show daily stats (YYYY-MM-DD, defaults to today)')
    .option('-s, --session', 'Show current session stats')
    .option('-r, --reset', 'Reset session stats')
    .option('-j, --json', 'Output as JSON')
    .action(async (options: { daily?: string | boolean; session?: boolean; reset?: boolean; json?: boolean }) => {
      try {
        // Reset session
        if (options.reset) {
          resetSession();
          console.log(chalk.green('Session stats reset'));
          return;
        }

        // Daily stats
        if (options.daily !== undefined) {
          const date = typeof options.daily === 'string' ? options.daily : undefined;
          const stats = getDailyStats(date);

          if (!stats) {
            console.log(chalk.yellow(`No token logs found for ${date ?? 'today'}`));
            return;
          }

          if (options.json) {
            console.log(JSON.stringify(stats, null, 2));
          } else {
            console.log(chalk.cyan('Daily Token Usage'));
            console.log(chalk.gray('─'.repeat(40)));
            console.log(formatStats(stats));
          }
          return;
        }

        // Session stats (default)
        const stats = getSessionStats();

        if (stats.callCount === 0) {
          console.log(chalk.yellow('No API calls in current session'));
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(stats, null, 2));
        } else {
          console.log(chalk.cyan('Current Session Token Usage'));
          console.log(chalk.gray('─'.repeat(40)));
          console.log(formatStats(stats));
        }
      } catch (error) {
        console.error(chalk.red('Failed to get token stats'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  return cmd;
}

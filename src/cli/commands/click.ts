/**
 * click command - Click on an element via vision
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { captureScreen } from '../../core/screenshot.js';
import { locateElement } from '../../core/vision.js';
import { click } from '../../core/input.js';
import { smartClick } from '../../core/automation.js';
import { loadConfig } from '../../config/index.js';

export function clickCommand(): Command {
  return new Command('click')
    .description('Click on an element identified by description')
    .argument('<target>', 'Description of the element to click')
    .option('-s, --screen <number>', 'Screen number', '0')
    .option('-d, --dry-run', 'Show what would be clicked without clicking')
    .option('-v, --verbose', 'Show detailed output')
    .option('--no-verify', 'Disable feedback loop verification (faster but less reliable)')
    .option('--max-attempts <number>', 'Max retry attempts (default: from config)')
    .action(
      async (
        target: string,
        options: {
          screen: string;
          dryRun?: boolean;
          verbose?: boolean;
          verify?: boolean;
          maxAttempts?: string;
        }
      ) => {
        const config = loadConfig();
        const screen = parseInt(options.screen, 10);
        const maxAttempts = options.maxAttempts ? parseInt(options.maxAttempts, 10) : config.maxAttempts;
        const useSmartClick = options.verify !== false;

        if (useSmartClick && !options.dryRun) {
          // Use smart click with feedback loop
          const spinner = ora(`Looking for "${target}"...`).start();

          try {
            const result = await smartClick(target, {
              screen,
              maxAttempts,
              verbose: options.verbose ?? false,
            });

            if (result.success) {
              spinner.succeed(
                chalk.green(
                  `Clicked "${target}" at (${result.coordinates?.x}, ${result.coordinates?.y}) after ${result.attempts} attempt(s)`
                )
              );
              if (result.confidence !== undefined) {
                console.log(chalk.gray(`Confidence: ${(result.confidence * 100).toFixed(0)}%`));
              }
            } else {
              spinner.fail(chalk.red(`Failed to click "${target}" after ${result.attempts} attempts`));
              console.error(chalk.red(result.error));
              process.exit(1);
            }
          } catch (error) {
            spinner.fail(chalk.red('Failed to click'));
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
          }
        } else {
          // Use simple click (original behavior)
          const spinner = ora(`Looking for "${target}"...`).start();

          try {
            const screenshot = await captureScreen({ screen });

            if (options.verbose) {
              spinner.text = 'Analyzing screenshot with Claude...';
            }

            const coords = await locateElement(target, screenshot.base64);

            spinner.succeed(chalk.green(`Found "${target}" at (${coords.x}, ${coords.y})`));

            if (coords.confidence !== undefined) {
              console.log(chalk.gray(`Confidence: ${(coords.confidence * 100).toFixed(0)}%`));
            }

            if (options.dryRun) {
              console.log(chalk.yellow(`[DRY RUN] Would click at (${coords.x}, ${coords.y})`));
            } else {
              await click(coords.x, coords.y);
              console.log(chalk.green('Clicked!'));
            }
          } catch (error) {
            spinner.fail(chalk.red('Failed to click'));
            console.error(error instanceof Error ? error.message : error);
            process.exit(1);
          }
        }
      }
    );
}

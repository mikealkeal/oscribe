/**
 * click command - Click on an element via vision
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { captureScreen } from '../../core/screenshot.js';
import { locateElement } from '../../core/vision.js';
import { click } from '../../core/input.js';

export function clickCommand(): Command {
  return new Command('click')
    .description('Click on an element identified by description')
    .argument('<target>', 'Description of the element to click')
    .option('-s, --screen <number>', 'Screen number', '0')
    .option('-d, --dry-run', 'Show what would be clicked without clicking')
    .option('-v, --verbose', 'Show detailed output')
    .action(async (target: string, options: { screen: string; dryRun?: boolean; verbose?: boolean }) => {
      const spinner = ora(`Looking for "${target}"...`).start();

      try {
        // Capture screenshot
        const screen = parseInt(options.screen, 10);
        const screenshot = await captureScreen({ screen });

        if (options.verbose) {
          spinner.text = 'Analyzing screenshot with Claude...';
        }

        // Locate element
        const coords = await locateElement(target, screenshot.base64);

        spinner.succeed(
          chalk.green(`Found "${target}" at (${coords.x}, ${coords.y})`)
        );

        if (coords.confidence !== undefined) {
          console.log(chalk.gray(`Confidence: ${(coords.confidence * 100).toFixed(0)}%`));
        }

        // Click
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
    });
}

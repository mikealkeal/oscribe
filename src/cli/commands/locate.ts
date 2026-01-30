/**
 * locate command - Find an element without clicking
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { captureScreen } from '../../core/screenshot.js';
import { locateElement } from '../../core/vision.js';

export function locateCommand(): Command {
  return new Command('locate')
    .description('Locate an element by description (find without clicking)')
    .argument('<target>', 'Description of the element to find')
    .option('-s, --screen <number>', 'Screen number', '0')
    .option('-v, --verbose', 'Show detailed output')
    .action(async (target: string, options: { screen: string; verbose?: boolean }) => {
      const spinner = ora(`Looking for "${target}"...`).start();

      try {
        const screen = parseInt(options.screen, 10);
        const screenshot = await captureScreen({ screen });

        if (options.verbose) {
          spinner.text = 'Analyzing screenshot with Claude...';
        }

        const coords = await locateElement(target, screenshot.base64);

        spinner.succeed(chalk.green(`Found "${target}"`));
        console.log(`  Coordinates: (${coords.x}, ${coords.y})`);
        if (coords.confidence !== undefined) {
          console.log(`  Confidence: ${(coords.confidence * 100).toFixed(0)}%`);
        }
      } catch (error) {
        spinner.fail(chalk.red('Element not found'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });
}

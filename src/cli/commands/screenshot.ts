/**
 * screenshot command - Capture screen
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { writeFileSync } from 'node:fs';
import { captureScreen, listScreens } from '../../core/screenshot.js';
import { describeScreen } from '../../core/vision.js';

export function screenshotCommand(): Command {
  return new Command('screenshot')
    .description('Capture a screenshot')
    .option('-s, --screen <number>', 'Screen number', '0')
    .option('-o, --output <file>', 'Output file path')
    .option('--describe', 'Describe the screen content using vision')
    .option('--list', 'List available screens')
    .action(
      async (options: { screen: string; output?: string; describe?: boolean; list?: boolean }) => {
        try {
          // List screens
          if (options.list) {
            const screens = await listScreens();
            console.log(chalk.cyan('Available screens:'));
            screens.forEach((s, i) => {
              console.log(`  ${i}: ${s.name} (id: ${s.id})`);
            });
            return;
          }

          const spinner = ora('Capturing screenshot...').start();
          const screen = parseInt(options.screen, 10);
          const screenshot = await captureScreen({ screen });

          // Save to file if output specified
          if (options.output) {
            writeFileSync(options.output, screenshot.buffer);
            spinner.succeed(chalk.green(`Screenshot saved to ${options.output}`));
          } else {
            spinner.succeed(chalk.green('Screenshot captured'));
          }

          // Describe if requested
          if (options.describe) {
            const descSpinner = ora('Analyzing screen...').start();
            const description = await describeScreen(screenshot.base64);
            descSpinner.succeed(chalk.green('Screen description:'));
            console.log();
            console.log(description);
          }
        } catch (error) {
          console.error(chalk.red('Failed to capture screenshot'));
          console.error(error instanceof Error ? error.message : error);
          process.exit(1);
        }
      }
    );
}

/**
 * voiceover command - Manage VoiceOver screen reader for Electron accessibility (macOS)
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  getVoiceOverStatus,
  startVoiceOver,
  stopVoiceOver,
} from '../../core/voiceover.js';

export function voiceoverCommand(): Command {
  const cmd = new Command('voiceover')
    .description('Manage VoiceOver screen reader for Electron app accessibility (macOS only)');

  cmd
    .command('status')
    .description('Show VoiceOver status')
    .action(async () => {
      const spinner = ora('Checking VoiceOver status...').start();

      try {
        const status = await getVoiceOverStatus();
        spinner.stop();

        console.log();
        console.log(chalk.bold('VoiceOver Status'));
        console.log('─'.repeat(40));
        console.log(
          `Available:     ${status.available ? chalk.green('Yes') : chalk.yellow('No (macOS only)')}`
        );
        console.log(
          `Running:       ${status.running ? chalk.green('Yes') : chalk.gray('No')}`
        );
        console.log(
          `Can control:   ${status.canControl ? chalk.green('Yes') : chalk.yellow('No (grant Accessibility permissions)')}`
        );
        console.log();
      } catch (error) {
        spinner.fail(chalk.red('Failed to check VoiceOver status'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  cmd
    .command('start')
    .description('Start VoiceOver in silent mode (no audio)')
    .option('--with-speech', 'Start VoiceOver with speech enabled')
    .action(async (options: { withSpeech?: boolean }) => {
      if (process.platform !== 'darwin') {
        console.log(chalk.yellow('VoiceOver is only available on macOS'));
        return;
      }

      const silent = !options.withSpeech;
      const spinner = ora(`Starting VoiceOver${silent ? ' in silent mode' : ''}...`).start();

      try {
        const success = await startVoiceOver(silent);

        if (success) {
          spinner.succeed(chalk.green(`VoiceOver started${silent ? ' in silent mode (no audio)' : ''}`));
          if (silent) {
            console.log();
            console.log(chalk.gray('VoiceOver is running without speech synthesis.'));
            console.log(chalk.gray('UI Automation features are active.'));
          }
        } else {
          spinner.fail(chalk.red('Failed to start VoiceOver'));
          process.exit(1);
        }
      } catch (error) {
        spinner.fail(chalk.red('Failed to start VoiceOver'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  cmd
    .command('stop')
    .description('Stop VoiceOver')
    .option('--no-restore-speech', 'Do not restore speech settings when stopping')
    .action(async (options: { restoreSpeech?: boolean }) => {
      if (process.platform !== 'darwin') {
        console.log(chalk.yellow('VoiceOver is only available on macOS'));
        return;
      }

      const restoreSpeech = options.restoreSpeech !== false;
      const spinner = ora('Stopping VoiceOver...').start();

      try {
        const success = await stopVoiceOver(restoreSpeech);

        if (success) {
          spinner.succeed(chalk.green('VoiceOver stopped'));
        } else {
          spinner.fail(chalk.red('Failed to stop VoiceOver'));
          process.exit(1);
        }
      } catch (error) {
        spinner.fail(chalk.red('Failed to stop VoiceOver'));
        console.error(error instanceof Error ? error.message : error);
        process.exit(1);
      }
    });

  // Default action: show status
  cmd.action(async () => {
    const status = await getVoiceOverStatus();

    console.log();
    console.log(chalk.bold('VoiceOver Screen Reader (macOS)'));
    console.log('─'.repeat(40));
    console.log(
      `Status: ${status.available ? (status.running ? chalk.green('Running') : chalk.gray('Available')) : chalk.yellow('Not available (macOS only)')}`
    );
    console.log();
    console.log('Commands:');
    console.log(`  ${chalk.yellow('oscribe voiceover status')}   Show detailed status`);
    console.log(`  ${chalk.yellow('oscribe voiceover start')}    Start VoiceOver silently`);
    console.log(`  ${chalk.yellow('oscribe voiceover stop')}     Stop VoiceOver`);
    console.log();
    console.log(
      chalk.gray('VoiceOver enables full UI element detection in Electron apps.')
    );
  });

  return cmd;
}

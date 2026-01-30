#!/usr/bin/env node
/**
 * Test automation avec SessionRecorder - Focus sur Brave existant
 */

import { SessionRecorder } from './dist/src/core/session-recorder.js';
import { captureScreen } from './dist/src/core/screenshot.js';
import { focusWindow } from './dist/src/core/windows.js';
import robot from 'robotjs';

console.log('🎬 Test avec focus sur Brave existant...\n');

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function automateWithRecording() {
  const recorder = new SessionRecorder('Focus Brave existant et aller sur Google');
  console.log(`✅ Session: ${recorder.getSessionDir()}\n`);

  try {
    // Screenshot initial
    console.log('📸 Screenshot initial...');
    const initialScreen = await captureScreen({ screen: 0 });
    recorder.saveScreenshot(initialScreen.base64, 'initial');

    // Action 1: Focus Brave
    console.log('📝 Action 1: Focus sur Brave...');
    await recorder.recordAction(
      'focus',
      { window: 'Brave' },
      async () => {
        await focusWindow('Brave');
        await wait(500);

        const afterFocus = await captureScreen({ screen: 0 });
        recorder.saveScreenshot(afterFocus.base64, 'brave-focused');
      }
    );
    console.log('   ✅ Brave en focus');

    // Action 2: Nouvel onglet
    console.log('📝 Action 2: Nouvel onglet (Ctrl+T)...');
    await recorder.recordAction(
      'hotkey',
      { keys: 'ctrl+t' },
      async () => {
        robot.keyTap('t', ['control']);
        await wait(1000);

        const afterTab = await captureScreen({ screen: 0 });
        recorder.saveScreenshot(afterTab.base64, 'new-tab');
      }
    );
    console.log('   ✅ Nouvel onglet');

    // Action 3: Taper google.com
    console.log('📝 Action 3: Taper "google.com"...');
    await recorder.recordAction(
      'type',
      { text: 'google.com' },
      async () => {
        robot.typeString('google.com');
        await wait(500);

        const afterType = await captureScreen({ screen: 0 });
        recorder.saveScreenshot(afterType.base64, 'typed');
      }
    );
    console.log('   ✅ URL tapée');

    // Action 4: Enter
    console.log('📝 Action 4: Enter...');
    await recorder.recordAction(
      'hotkey',
      { keys: 'enter' },
      async () => {
        robot.keyTap('enter');
        await wait(3000);

        const afterEnter = await captureScreen({ screen: 0 });
        recorder.saveScreenshot(afterEnter.base64, 'google-loaded');
      }
    );
    console.log('   ✅ Google chargé dans BRAVE');

    // Final
    console.log('📸 Screenshot final...');
    const finalScreen = await captureScreen({ screen: 0 });
    recorder.saveScreenshot(finalScreen.base64, 'final');

    recorder.endSession();

    console.log('\n✅ Session terminée!');
    console.log(`📂 ${recorder.getSessionDir()}`);
    console.log('\n🔥 Cette fois c\'est BRAVE! Pas Firefox! 🔥\n');

  } catch (error) {
    console.error('\n❌ Erreur:', error.message);
    recorder.endSession();
  }
}

automateWithRecording().catch(console.error);

#!/usr/bin/env node
/**
 * Test automation avec SessionRecorder - VERSION CORRECTE
 * Ouvre VRAIMENT Brave (pas Firefox!) et va sur Google
 */

import { SessionRecorder } from './dist/src/core/session-recorder.js';
import { captureScreen } from './dist/src/core/screenshot.js';
import robot from 'robotjs';

console.log('🎬 Démarrage de la session (BRAVE cette fois!)...\n');

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function automateWithRecording() {
  const recorder = new SessionRecorder('Ouvrir BRAVE (pas Firefox!) et aller sur Google');
  console.log(`✅ Session créée: ${recorder.getSessionDir()}\n`);

  try {
    // Screenshot initial
    console.log('📸 Screenshot initial...');
    const initialScreen = await captureScreen({ screen: 0 });
    recorder.saveScreenshot(initialScreen.base64, 'initial');
    await wait(500);

    // Action 1: Ouvrir Brave avec Win+R puis brave.exe
    console.log('📝 Action 1: Ouvrir Brave (Win+R)...');
    await recorder.recordAction(
      'open_brave',
      { method: 'win+r + brave.exe' },
      async () => {
        // Win+R pour ouvrir Run dialog
        robot.keyTap('r', ['command']); // command = Win key
        await wait(500);

        // Taper "brave.exe"
        robot.typeString('brave.exe');
        await wait(500);

        // Enter pour lancer
        robot.keyTap('enter');
        await wait(2000); // Attendre que Brave s'ouvre

        const afterOpen = await captureScreen({ screen: 0 });
        recorder.saveScreenshot(afterOpen.base64, 'brave-opened');
      }
    );
    console.log('   ✅ Brave ouvert (VRAIMENT!)');

    // Action 2: Nouvel onglet Ctrl+T
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
    console.log('   ✅ Nouvel onglet créé');

    // Action 3: Taper google.com
    console.log('📝 Action 3: Taper "google.com"...');
    await recorder.recordAction(
      'type',
      { text: 'google.com' },
      async () => {
        robot.typeString('google.com');
        await wait(500);

        const afterType = await captureScreen({ screen: 0 });
        recorder.saveScreenshot(afterType.base64, 'typed-google');
      }
    );
    console.log('   ✅ URL tapée');

    // Action 4: Enter
    console.log('📝 Action 4: Valider (Enter)...');
    await recorder.recordAction(
      'hotkey',
      { keys: 'enter' },
      async () => {
        robot.keyTap('enter');
        await wait(3000); // Attendre chargement

        const afterEnter = await captureScreen({ screen: 0 });
        recorder.saveScreenshot(afterEnter.base64, 'google-loaded');
      }
    );
    console.log('   ✅ Page Google chargée');

    // Screenshot final
    console.log('📸 Screenshot final...');
    const finalScreen = await captureScreen({ screen: 0 });
    recorder.saveScreenshot(finalScreen.base64, 'final-brave-google');

    // Fin
    console.log('\n🎬 Fin de la session...');
    recorder.endSession();

    console.log('\n✅ Session enregistrée! BRAVE cette fois!');
    console.log(`\n📂 Emplacement: ${recorder.getSessionDir()}`);
    console.log('\n💡 Vérifie que c\'est bien Brave et pas Firefox!\n');

  } catch (error) {
    console.error('\n❌ Erreur:', error.message);
    recorder.endSession();
  }
}

automateWithRecording().catch(console.error);

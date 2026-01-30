#!/usr/bin/env node
/**
 * Test automation avec SessionRecorder
 * Ouvre Brave et va sur Google en enregistrant tout
 */

import { SessionRecorder } from './dist/src/core/session-recorder.js';
import { captureScreen } from './dist/src/core/screenshot.js';
import robot from 'robotjs';

console.log('🎬 Démarrage de la session enregistrée...\n');

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function automateWithRecording() {
  // Créer la session
  const recorder = new SessionRecorder('Ouvrir Brave et aller sur Google');
  console.log(`✅ Session créée: ${recorder.getSessionDir()}\n`);

  try {
    // Action 1: Screenshot initial
    console.log('📸 Screenshot initial...');
    const initialScreen = await captureScreen({ screen: 0 });
    recorder.saveScreenshot(initialScreen.base64, 'initial');
    await wait(500);

    // Action 2: Ouvrir Brave avec Win+1
    console.log('📝 Action 1: Ouvrir Brave (Win+1)...');
    await recorder.recordAction(
      'hotkey',
      { keys: 'win+1' },
      async () => {
        robot.keyTap('1', ['command']); // command = Win sur Windows
        await wait(1000); // Attendre que Brave s'ouvre

        const afterOpen = await captureScreen({ screen: 0 });
        recorder.saveScreenshot(afterOpen.base64, 'brave-opened');
      }
    );
    console.log('   ✅ Brave ouvert');

    // Action 3: Nouvel onglet Ctrl+T
    console.log('📝 Action 2: Nouvel onglet (Ctrl+T)...');
    await recorder.recordAction(
      'hotkey',
      { keys: 'ctrl+t' },
      async () => {
        robot.keyTap('t', ['control']);
        await wait(500);

        const afterTab = await captureScreen({ screen: 0 });
        recorder.saveScreenshot(afterTab.base64, 'new-tab');
      }
    );
    console.log('   ✅ Nouvel onglet créé');

    // Action 4: Taper google.com
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

    // Action 5: Appuyer sur Enter
    console.log('📝 Action 4: Valider (Enter)...');
    await recorder.recordAction(
      'hotkey',
      { keys: 'enter' },
      async () => {
        robot.keyTap('enter');
        await wait(2000); // Attendre le chargement de Google

        const afterEnter = await captureScreen({ screen: 0 });
        recorder.saveScreenshot(afterEnter.base64, 'google-loaded');
      }
    );
    console.log('   ✅ Page Google chargée');

    // Screenshot final
    console.log('📸 Screenshot final...');
    const finalScreen = await captureScreen({ screen: 0 });
    recorder.saveScreenshot(finalScreen.base64, 'final');

    // Fin de session
    console.log('\n🎬 Fin de la session...');
    recorder.endSession();

    console.log('\n✅ Session enregistrée avec succès!');
    console.log(`\n📂 Emplacement: ${recorder.getSessionDir()}`);
    console.log('\n📄 Fichiers générés:');
    console.log('   - session.json    (données brutes)');
    console.log('   - REPORT.md       (rapport avec timeline)');
    console.log('   - screenshots/    (tous les screenshots)');
    console.log('\n💡 Ouvre REPORT.md pour voir le rapport complet!\n');

  } catch (error) {
    console.error('\n❌ Erreur:', error.message);
    recorder.endSession();
  }
}

automateWithRecording().catch(console.error);

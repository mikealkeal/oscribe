#!/usr/bin/env node
/**
 * Test SessionRecorder
 */

import { SessionRecorder } from './dist/src/core/session-recorder.js';

console.log('🧪 Testing SessionRecorder...\n');

async function testSessionRecorder() {
  // Create session
  const recorder = new SessionRecorder('Test: Ouvrir Brave et aller sur Google');
  console.log(`✅ Session créée: ${recorder.getSessionDir()}\n`);

  // Action 1: Click (success)
  console.log('📝 Action 1: Click Brave icon...');
  await recorder.recordAction(
    'click',
    { target: 'Brave icon' },
    async () => {
      // Simulate click
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log('   → Click simulé avec succès');
      return { x: 100, y: 200 };
    }
  );

  // Action 2: Hotkey (success)
  console.log('📝 Action 2: Ctrl+T...');
  await recorder.recordAction(
    'hotkey',
    { keys: 'ctrl+t' },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
      console.log('   → Hotkey simulé avec succès');
    }
  );

  // Action 3: Type (success)
  console.log('📝 Action 3: Type google.com...');
  await recorder.recordAction(
    'type',
    { text: 'google.com' },
    async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      console.log('   → Type simulé avec succès');
    }
  );

  // Action 4: Error simulation
  console.log('📝 Action 4: Click non-existent button (error)...');
  try {
    await recorder.recordAction(
      'click',
      { target: 'Non-existent button' },
      async () => {
        throw new Error('Element not found: "Non-existent button"');
      }
    );
  } catch (error) {
    console.log(`   → Erreur capturée: ${error.message}`);
  }

  // Save fake screenshot
  console.log('📝 Sauvegarde screenshot simulé...');
  const fakeScreenshot = Buffer.from('fake-screenshot-data').toString('base64');
  const screenshotPath = recorder.saveScreenshot(fakeScreenshot, 'test-screenshot');
  console.log(`   → Screenshot sauvegardé: ${screenshotPath}`);

  // End session
  console.log('\n📝 Fin de session...');
  recorder.endSession();

  console.log('\n✅ Test terminé!');
  console.log(`📂 Session sauvegardée dans: ${recorder.getSessionDir()}`);
  console.log('\nVérifiez les fichiers:');
  console.log('  - session.json');
  console.log('  - REPORT.md');
  console.log('  - screenshots/');
}

testSessionRecorder().catch(console.error);

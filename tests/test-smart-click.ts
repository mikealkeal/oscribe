/**
 * Test du feedback loop intelligent (smartClick)
 *
 * Scénario:
 * 1. Focus sur Notepad (ou Brave)
 * 2. Click avec vérification automatique
 * 3. Vérifier le retry si échec
 *
 * Usage:
 *   npx tsx tests/test-smart-click.ts
 */

import { smartClick } from '../dist/src/core/automation.js';
import { focusWindow, listWindows } from '../dist/src/core/windows.js';

async function main(): Promise<void> {
  console.log('=== Test Smart Click avec Feedback Loop ===\n');

  try {
    // 1. Lister les fenêtres disponibles
    console.log('Fenêtres disponibles:');
    const windows = await listWindows();
    windows.forEach((w: { title: string; app: string }, i: number) => {
      console.log(`  ${i + 1}. ${w.title} (${w.app})`);
    });
    console.log('');

    // 2. Focus sur Brave (ou autre app)
    const targetApp = 'Brave';
    console.log(`Focus sur ${targetApp}...`);

    try {
      await focusWindow(targetApp);
      console.log(`✓ ${targetApp} en focus\n`);
    } catch {
      console.log(`⚠ ${targetApp} non trouvé, test avec la fenêtre active\n`);
    }

    // 3. Test Smart Click avec feedback loop
    console.log('Test 1: Smart Click avec vérification');
    console.log('Target: "address bar" (barre d\'adresse)\n');

    const result = await smartClick('address bar', {
      maxAttempts: 3,
      verifyDelay: 800,
      verbose: true,
    });

    console.log('\n--- Résultat ---');
    console.log(`Success: ${result.success}`);
    console.log(`Attempts: ${result.attempts}`);
    if (result.coordinates) {
      console.log(`Coordinates: (${result.coordinates.x}, ${result.coordinates.y})`);
    }
    if (result.confidence !== undefined) {
      console.log(`Confidence: ${(result.confidence * 100).toFixed(0)}%`);
    }
    if (result.error) {
      console.log(`Error: ${result.error}`);
    }

    console.log('\n✓ Test terminé');

  } catch (error) {
    console.error('✗ Erreur:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();

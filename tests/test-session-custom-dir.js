#!/usr/bin/env node
/**
 * Test SessionRecorder avec dossier custom
 */

import { SessionRecorder } from './dist/src/core/session-recorder.js';
import { saveConfig, loadConfig } from './dist/src/config/index.js';
import { join } from 'node:path';
import { rmSync, existsSync } from 'node:fs';

const customDir = join(process.cwd(), 'test-sessions');

console.log('🧪 Test SessionRecorder avec dossier custom...\n');

// Cleanup
if (existsSync(customDir)) {
  console.log('🧹 Nettoyage du dossier de test...');
  rmSync(customDir, { recursive: true, force: true });
}

// Configure custom session dir
console.log(`📁 Configuration: sessionDir = ${customDir}`);
const currentConfig = loadConfig();
saveConfig({
  ...currentConfig,
  sessionDir: customDir,
});

// Create test session
console.log('📝 Création d\'une session de test...');
const recorder = new SessionRecorder('Test avec dossier custom');
const sessionDir = recorder.getSessionDir();

console.log(`\n✅ Session créée: ${sessionDir}`);

// Verify it's in the custom directory
if (sessionDir.startsWith(customDir)) {
  console.log('✅ Session créée dans le dossier custom!');
} else {
  console.error('❌ ERREUR: Session pas dans le dossier custom!');
  process.exit(1);
}

// Add test action
await recorder.recordAction('test', { value: 'test' }, async () => {
  console.log('   → Action test exécutée');
});

// End session
recorder.endSession();

console.log('\n📊 Résumé:');
console.log(`   Dossier custom: ${customDir}`);
console.log(`   Session: ${sessionDir}`);
console.log('\n💡 Pour utiliser en production:');
console.log('   Édite ~/.osbot/config.json et ajoute:');
console.log('   "sessionDir": "ton/dossier/custom"');

// Restore original config
console.log('\n🔄 Restauration de la config originale...');
saveConfig({
  ...currentConfig,
  sessionDir: undefined,
});

console.log('✅ Test terminé!\n');

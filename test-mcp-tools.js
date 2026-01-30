#!/usr/bin/env node
/**
 * Test script to verify MCP tools configuration
 * Checks that os_click, os_click_at, and os_locate are properly defined
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, 'dist/src/mcp/server.js');

console.log('📋 Verifying MCP tools configuration...\n');

try {
  const serverCode = readFileSync(serverPath, 'utf-8');

  // Check for vision-based tools
  const checks = [
    {
      name: 'os_click with target parameter',
      pattern: /name:\s*['"]os_click['"]\s*,[\s\S]*?target:\s*{\s*type:\s*['"]string['"]/,
      description: 'Vision-based click with description'
    },
    {
      name: 'os_click_at for coordinates',
      pattern: /name:\s*['"]os_click_at['"]/,
      description: 'Fallback click with x,y coordinates'
    },
    {
      name: 'os_locate for element location',
      pattern: /name:\s*['"]os_locate['"]/,
      description: 'Locate element without clicking'
    },
    {
      name: 'locateElement import',
      pattern: /import\s*{[^}]*locateElement[^}]*}\s*from\s*['"][^'"]*vision/,
      description: 'Vision module imported'
    },
    {
      name: 'os_click handler uses locateElement',
      pattern: /case\s*['"]os_click['"]\s*:[\s\S]{0,500}locateElement\s*\(/,
      description: 'os_click uses vision to find elements'
    },
    {
      name: 'os_locate handler uses locateElement',
      pattern: /case\s*['"]os_locate['"]\s*:[\s\S]{0,500}locateElement\s*\(/,
      description: 'os_locate uses vision to find elements'
    }
  ];

  let passed = 0;
  let failed = 0;

  for (const check of checks) {
    if (check.pattern.test(serverCode)) {
      console.log(`✅ ${check.name}`);
      console.log(`   ${check.description}`);
      passed++;
    } else {
      console.log(`❌ ${check.name}`);
      console.log(`   ${check.description}`);
      failed++;
    }
  }

  console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

  if (failed === 0) {
    console.log('\n🎉 All MCP tools are properly configured!');
    console.log('\n📝 Vision-based tools available:');
    console.log('   • os_click      - Click by description (e.g., "Submit button")');
    console.log('   • os_locate     - Find element coordinates');
    console.log('   • os_click_at   - Click at exact x,y (fallback)');
    process.exit(0);
  } else {
    console.error('\n❌ Some tools are missing or misconfigured');
    process.exit(1);
  }
} catch (error) {
  console.error('❌ Error reading MCP server:', error.message);
  console.error('\nMake sure to run: npm run build');
  process.exit(1);
}

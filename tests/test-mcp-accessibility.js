#!/usr/bin/env node

/**
 * Test script for MCP accessibility tools
 * Tests os_accessibility_tree and os_find_element
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Start MCP server
const serverPath = join(__dirname, 'dist/src/mcp/server.js');
const server = spawn('node', [serverPath], {
  stdio: ['pipe', 'pipe', 'inherit'],
});

let responseBuffer = '';

server.stdout.on('data', (data) => {
  responseBuffer += data.toString();

  // Try to parse complete JSON-RPC responses
  const lines = responseBuffer.split('\n');
  responseBuffer = lines.pop() || ''; // Keep incomplete line in buffer

  for (const line of lines) {
    if (line.trim()) {
      try {
        const response = JSON.parse(line);
        console.log('📥 Response:', JSON.stringify(response, null, 2));
      } catch (e) {
        // Not JSON, might be header
      }
    }
  }
});

// Send JSON-RPC request
function sendRequest(id, method, params = {}) {
  const request = {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };
  console.log('📤 Request:', JSON.stringify(request, null, 2));
  server.stdin.write(JSON.stringify(request) + '\n');
}

// Test sequence
setTimeout(() => {
  console.log('\n=== Test 1: Initialize ===');
  sendRequest(1, 'initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'test-client', version: '1.0.0' },
  });
}, 500);

setTimeout(() => {
  console.log('\n=== Test 2: List tools ===');
  sendRequest(2, 'tools/list', {});
}, 1500);

setTimeout(() => {
  console.log('\n=== Test 3: Extract accessibility tree ===');
  sendRequest(3, 'tools/call', {
    name: 'os_accessibility_tree',
    arguments: {},
  });
}, 2500);

setTimeout(() => {
  console.log('\n=== Test 4: Find element "7" ===');
  sendRequest(4, 'tools/call', {
    name: 'os_find_element',
    arguments: { query: '7' },
  });
}, 4000);

setTimeout(() => {
  console.log('\n=== Tests complete ===');
  server.kill();
  process.exit(0);
}, 6000);

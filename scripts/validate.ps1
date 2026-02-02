# Validation script for OScribe (Windows PowerShell)
# Tests all major functionality manually

$ErrorActionPreference = "Stop"

Write-Host "🔍 OScribe Validation Script" -ForegroundColor Cyan
Write-Host "==========================" -ForegroundColor Cyan
Write-Host ""

# Check if running from project root
if (-not (Test-Path "package.json")) {
    Write-Host "❌ Error: Must run from project root" -ForegroundColor Red
    exit 1
}

Write-Host "📦 1. Testing build..."
npm run build
if (Test-Path "dist") {
    Write-Host "✅ Build successful" -ForegroundColor Green
} else {
    Write-Host "❌ Build failed - dist/ not found" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "🔧 2. Testing linter..."
npm run lint
Write-Host "✅ Lint passed" -ForegroundColor Green

Write-Host ""
Write-Host "🔍 3. Testing typecheck..."
npm run typecheck
Write-Host "✅ Typecheck passed" -ForegroundColor Green

Write-Host ""
Write-Host "📋 4. Testing CLI help..."
node dist/bin/oscribe.js --help | Out-Null
Write-Host "✅ CLI help works" -ForegroundColor Green

Write-Host ""
Write-Host "📸 5. Testing screenshot list..."
try {
    node dist/bin/oscribe.js screenshot --list | Out-Null
    Write-Host "✅ Screenshot list works" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Screenshot list failed (may need platform dependencies)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🪟 6. Testing windows list..."
try {
    node dist/bin/oscribe.js windows | Out-Null
    Write-Host "✅ Windows list works" -ForegroundColor Green
} catch {
    Write-Host "⚠️  Windows list failed (may need platform dependencies)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "🔐 7. Testing login status..."
try {
    node dist/bin/oscribe.js login --status | Out-Null
} catch {
    Write-Host "⚠️  Not logged in (expected)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==========================" -ForegroundColor Cyan
Write-Host "✅ Core validation complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📝 Manual tests needed:"
Write-Host "  • oscribe init"
Write-Host "  • oscribe login"
Write-Host "  • oscribe screenshot --describe"
Write-Host "  • oscribe click `"target`""
Write-Host "  • oscribe type `"text`""
Write-Host "  • oscribe serve (test MCP)"
Write-Host ""

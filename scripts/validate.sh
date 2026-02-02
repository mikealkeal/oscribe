#!/usr/bin/env bash
# Validation script for OScribe
# Tests all major functionality manually

set -e

echo "🔍 OScribe Validation Script"
echo "=========================="
echo ""

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if running from project root
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ Error: Must run from project root${NC}"
    exit 1
fi

echo "📦 1. Testing build..."
npm run build
if [ -d "dist" ]; then
    echo -e "${GREEN}✅ Build successful${NC}"
else
    echo -e "${RED}❌ Build failed - dist/ not found${NC}"
    exit 1
fi

echo ""
echo "🔧 2. Testing linter..."
npm run lint
echo -e "${GREEN}✅ Lint passed${NC}"

echo ""
echo "🔍 3. Testing typecheck..."
npm run typecheck
echo -e "${GREEN}✅ Typecheck passed${NC}"

echo ""
echo "📋 4. Testing CLI help..."
node dist/bin/oscribe.js --help > /dev/null
echo -e "${GREEN}✅ CLI help works${NC}"

echo ""
echo "📸 5. Testing screenshot list..."
if node dist/bin/oscribe.js screenshot --list > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Screenshot list works${NC}"
else
    echo -e "${YELLOW}⚠️  Screenshot list failed (may need platform dependencies)${NC}"
fi

echo ""
echo "🪟 6. Testing windows list..."
if node dist/bin/oscribe.js windows > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Windows list works${NC}"
else
    echo -e "${YELLOW}⚠️  Windows list failed (may need platform dependencies)${NC}"
fi

echo ""
echo "🔐 7. Testing login status..."
node dist/bin/oscribe.js login --status || echo -e "${YELLOW}⚠️  Not logged in (expected)${NC}"

echo ""
echo "=========================="
echo -e "${GREEN}✅ Core validation complete!${NC}"
echo ""
echo "📝 Manual tests needed:"
echo "  • oscribe init"
echo "  • oscribe login"
echo "  • oscribe screenshot --describe"
echo "  • oscribe click \"target\""
echo "  • oscribe type \"text\""
echo "  • oscribe serve (test MCP)"
echo ""

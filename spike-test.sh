#!/bin/bash
# Spike test: dynamic import in compiled Bun binary
#
# Tests whether the compiled facet binary can dynamically import()
# a TypeScript adapter file from the filesystem at runtime.

set -e

BINARY="./packages/cli/dist/facet"
ADAPTER_TS="./packages/adapters/opencode/src/index.ts"
ADAPTER_ABS="$(cd "$(dirname "$ADAPTER_TS")" && pwd)/$(basename "$ADAPTER_TS")"

echo "=== Bun Dynamic Import Spike ==="
echo ""
echo "Binary: $BINARY"
echo "Adapter (TS): $ADAPTER_ABS"
echo ""

# Test 1: TypeScript file via absolute path
echo "--- Test 1: Compiled binary + TypeScript adapter (absolute path) ---"
if "$BINARY" spike-adapter "$ADAPTER_ABS"; then
  echo ">>> TEST 1 PASSED: Compiled binary can dynamically import .ts from disk"
else
  echo ">>> TEST 1 FAILED: Compiled binary cannot import .ts"
fi

echo ""

# Test 2: TypeScript file via relative path
echo "--- Test 2: Compiled binary + TypeScript adapter (relative path) ---"
if "$BINARY" spike-adapter "$ADAPTER_TS"; then
  echo ">>> TEST 2 PASSED: Compiled binary can dynamically import .ts via relative path"
else
  echo ">>> TEST 2 FAILED: Compiled binary cannot import .ts via relative path"
fi

echo ""

# Test 3: Try importing from a temp directory (simulating ~/.facets/adapters/)
echo "--- Test 3: Compiled binary + adapter copied to /tmp (simulating external adapter) ---"
TMPDIR_ADAPTER="$(mktemp -d)/adapter-opencode"
mkdir -p "$TMPDIR_ADAPTER/src"
cp "$ADAPTER_ABS" "$TMPDIR_ADAPTER/src/index.ts"
# Copy the adapter contract so the import resolves
# Actually, the adapter imports @agent-facets/adapter — will that resolve from /tmp?
# This is an important test!
if "$BINARY" spike-adapter "$TMPDIR_ADAPTER/src/index.ts"; then
  echo ">>> TEST 3 PASSED: Compiled binary can import adapter from arbitrary filesystem location"
else
  echo ">>> TEST 3 FAILED: Import from arbitrary location failed (likely can't resolve @agent-facets/adapter)"
  echo ">>> Trying without the @agent-facets/adapter import..."

  # Create a self-contained adapter with no external imports
  cat > "$TMPDIR_ADAPTER/src/standalone.ts" << 'EOF'
const adapter = {
  name: 'opencode-standalone',
  rootDir: '.opencode',
  isAvailable(projectRoot: string): boolean {
    try {
      const { existsSync } = require('node:fs')
      const { join } = require('node:path')
      return existsSync(join(projectRoot, '.opencode'))
    } catch { return false }
  },
  validateConfig(_data: unknown) {
    return { errors: [], warnings: [] }
  },
  assetPath(type: string, name: string): string {
    if (type === 'skills') return `.opencode/skills/${name}/SKILL.md`
    return `.opencode/${type}/${name}.md`
  },
}
export default adapter
EOF

  if "$BINARY" spike-adapter "$TMPDIR_ADAPTER/src/standalone.ts"; then
    echo ">>> TEST 3b PASSED: Self-contained adapter (no package imports) works from /tmp"
  else
    echo ">>> TEST 3b FAILED: Even self-contained adapter fails from /tmp"
  fi
fi

# Cleanup
rm -rf "$TMPDIR_ADAPTER"

echo ""
echo "=== Spike complete ==="

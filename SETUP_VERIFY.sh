#!/bin/bash

# Verification script for REST API multi-host implementation
# Tests connectivity and configuration between HVU and WSL agents

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}Work-OS REST API Multi-Host Verification${NC}\n"

# Colors for results
pass() {
  echo -e "${GREEN}✅ $1${NC}"
}

fail() {
  echo -e "${RED}❌ $1${NC}"
}

warn() {
  echo -e "${YELLOW}⏳ $1${NC}"
}

# Configuration
AGENT_URL="${WSL_AGENT_URL:-http://172.29.214.157:3001}"
HVU_URL="${HVU_URL:-http://localhost:3000}"
HVU_HOST="${HVU_HOST:-192.168.1.50}"

echo "=== Configuration ==="
echo "Agent URL: $AGENT_URL"
echo "HVU URL: $HVU_URL"
echo ""

# Test 1: Check if agent is reachable (local)
echo "=== Test 1: Agent Reachability ==="
if curl -sf "$AGENT_URL/healthz" > /dev/null 2>&1; then
  pass "Agent is reachable at $AGENT_URL"
  AGENT_HEALTH=$(curl -s "$AGENT_URL/healthz" | jq .)
  echo "  $AGENT_HEALTH"
else
  fail "Agent is not reachable at $AGENT_URL"
  echo "  Try: npm run dev:agent (on WSL)"
fi
echo ""

# Test 2: Check agent API endpoints
echo "=== Test 2: Agent API Endpoints ==="
if curl -sf "$AGENT_URL/api/sessions" > /dev/null 2>&1; then
  pass "Agent /api/sessions endpoint works"
  SESSION_COUNT=$(curl -s "$AGENT_URL/api/sessions" | jq '.sessions | length')
  echo "  Found $SESSION_COUNT sessions"
else
  fail "Agent /api/sessions endpoint not working"
fi
echo ""

# Test 3: Check HVU reachability
echo "=== Test 3: HVU Server Reachability ==="
if curl -sf "$HVU_URL/healthz" > /dev/null 2>&1 || curl -sf "$HVU_URL/api/sessions" > /dev/null 2>&1; then
  pass "HVU server is reachable at $HVU_URL"
else
  fail "HVU server is not reachable at $HVU_URL"
  echo "  Try: npm run start (on HVU)"
fi
echo ""

# Test 4: Check if HVU can reach agent
echo "=== Test 4: HVU → Agent Connectivity ==="
if ssh -q opa@$HVU_HOST "curl -sf $AGENT_URL/healthz > /dev/null" 2>/dev/null; then
  pass "HVU can reach agent at $AGENT_URL"
else
  warn "HVU cannot reach agent (requires SSH setup)"
  echo "  SSH command: ssh opa@$HVU_HOST \"curl $AGENT_URL/healthz\""
fi
echo ""

# Test 5: Check environment configuration
echo "=== Test 5: Environment Configuration ==="
if [ -n "$WORK_OS_HOSTS" ]; then
  pass "WORK_OS_HOSTS environment variable is set"
  if echo "$WORK_OS_HOSTS" | grep -q '"type".*"http"'; then
    pass "HTTP provider type found in WORK_OS_HOSTS"
  else
    warn "HTTP provider type not found in WORK_OS_HOSTS"
  fi
else
  fail "WORK_OS_HOSTS environment variable not set"
  echo "  Set it like:"
  echo "    export WORK_OS_HOSTS='[{\"hostId\":\"wsl\",\"type\":\"http\",\"agentUrl\":\"$AGENT_URL\"}]'"
fi
echo ""

# Test 6: Check HVU can see agent sessions
echo "=== Test 6: HVU Session Listing ==="
if curl -sf "$HVU_URL/api/sessions" > /dev/null 2>&1; then
  SESSIONS=$(curl -s "$HVU_URL/api/sessions" | jq '.sessions')
  TOTAL=$(echo "$SESSIONS" | jq 'length')
  if [ "$TOTAL" -gt 0 ]; then
    pass "HVU can list $TOTAL session(s)"

    # Check for WSL sessions
    WSL_SESSIONS=$(echo "$SESSIONS" | jq '[.[] | select(.hostId=="wsl")] | length')
    if [ "$WSL_SESSIONS" -gt 0 ]; then
      pass "HVU can see $WSL_SESSIONS WSL session(s)"
    else
      warn "No WSL sessions visible (check if agent has sessions)"
    fi
  else
    warn "HVU has no sessions yet"
  fi
else
  warn "Cannot reach HVU /api/sessions endpoint"
fi
echo ""

# Test 7: Check build status
echo "=== Test 7: Build Status ==="
if [ -f "dist/index.js" ] && [ -f "dist/server.js" ]; then
  pass "Build artifacts exist"
else
  warn "Build artifacts not found (run: npm run build)"
fi
echo ""

# Test 8: Configuration test
echo "=== Test 8: TypeScript Configuration ==="
if [ -f "tsconfig.agent.json" ]; then
  pass "Agent TypeScript config exists"
else
  fail "Agent TypeScript config missing"
fi
echo ""

# Summary
echo "=== Summary ==="
echo "To start the multi-host setup:"
echo ""
echo "1. On WSL (WSL terminal):"
echo "   cd ~/work/work-os"
echo "   npm run dev:agent"
echo ""
echo "2. On HVU (Docker container):"
echo "   export WORK_OS_HOSTS='[{\"hostId\":\"local\",\"type\":\"local\"},{\"hostId\":\"wsl\",\"type\":\"http\",\"agentUrl\":\"http://172.29.214.157:3001\"}]'"
echo "   npm run start"
echo ""
echo "3. Test the dashboard:"
echo "   curl http://localhost:3000/api/sessions"
echo ""

#!/usr/bin/env bash
# Builds the app and serves it with the mock AI provider, for end-to-end tests.
set -euo pipefail
export AI_PROVIDER=mock MOCK_AI_DELAY_MS=400 SESSION_SECRET=e2e-secret-0123456789abcdef
export MAX_INTERVIEWS_PER_DAY=1000 RATE_PLAN_PER_MINUTE=1000 RATE_FOLLOWUP_PER_MINUTE=1000 RATE_GRADE_PER_MINUTE=1000
npx next build
exec npx next start -p "${PORT:-3210}"

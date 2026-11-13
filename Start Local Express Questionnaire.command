#!/bin/bash
set -e
cd "$(dirname "$0")"
npm run local:start
for attempt in {1..40}; do
  response=$(curl -fsS "http://localhost:5174/_local/api/health" 2>/dev/null || true)
  case "$response" in
    *'"format":"local-express-v1"'*) open "http://localhost:5174"; exit 0 ;;
  esac
  sleep 0.25
done
echo "The local Express server did not become ready. Check .local-preview/server.log."
exit 1

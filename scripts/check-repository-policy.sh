#!/usr/bin/env bash
set -euo pipefail

failed=0

check_tracked_pattern() {
  local message="$1"
  local pattern="$2"
  local matches
  matches="$(git ls-files | grep -E "$pattern" || true)"
  if [[ -n "$matches" ]]; then
    echo "$message"
    echo "$matches"
    failed=1
  fi
}

check_tracked_pattern "Production hosting manifests are prohibited:" '(^|/)\.openai/hosting\.json$'
check_tracked_pattern "Recovery and production-inventory directories are prohibited:" '^(recovered|production-sites|evidence)/'
check_tracked_pattern "Raw personal or promotional media are prohibited:" '(^|/)(evidence|media|promo|screenshots?)/.*\.(png|jpe?g|gif|webp|mp4|mov|m4v|avi)$|(^|/)[^/]*(portrait|screenrecording|post-preview|promo-screenshot|landing-page)[^/]*\.(png|jpe?g|gif|webp|mp4|mov|m4v|avi)$'
check_tracked_pattern "Compiled distributables and archives are prohibited:" '\.(app|dmg|pkg|zip)(/|$)'
check_tracked_pattern "Private key and certificate containers are prohibited:" '\.(p8|p12|pem|key|mobileprovision)$'

environment_matches="$(git ls-files | grep -E '(^|/)\.env($|\.)' | grep -vE '(^|/)\.env\.example$' || true)"
if [[ -n "$environment_matches" ]]; then
  echo "Private environment files are prohibited; only .env.example is allowed:"
  echo "$environment_matches"
  failed=1
fi

python3 scripts/scan-public-secrets.py || failed=1

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo "Repository policy checks passed."

#!/usr/bin/env bash
#
# Apply the branch ruleset that protects `develop`.
# Run this ONCE, AFTER the repository has been made public
# (rulesets are unavailable on free private repos).
#
# Usage:  bash scripts/apply-develop-ruleset.sh
#
set -euo pipefail

REPO="NoiXdev/s3Manager"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JSON="$DIR/develop-ruleset.json"

# develop is the strict integration branch: PRs + a passing `Lint & Test`
# check are required. Nothing auto-pushes here — releases land on `main`
# (see scripts/apply-main-ruleset.sh), so no bypass actor is needed.
echo "Applying ruleset to $REPO from $JSON ..."

# Create the ruleset (fails if one named 'protect-develop' already exists).
gh api -X POST "repos/$REPO/rulesets" --input "$JSON"

echo
echo "Done. Verify with:"
echo "  gh api repos/$REPO/rulesets --jq '.[] | {id, name, enforcement}'"

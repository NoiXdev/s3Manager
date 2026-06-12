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

# --- GitHub Actions bypass (manual, one-time) -------------------------------
# The release workflow pushes CHANGELOG.md directly to develop, which the
# `pull_request` rule blocks. The GitHub Actions bot cannot be added as a
# bypass actor via the API on a user-owned (non-org) repo, so add it once in
# the UI after running this script:
#   Settings -> Rules -> Rulesets -> protect-develop -> Bypass list
#     -> Add bypass -> GitHub Actions -> mode "Always" -> Save
echo "Applying ruleset to $REPO from $JSON ..."

# Create the ruleset (fails if one named 'protect-develop' already exists).
gh api -X POST "repos/$REPO/rulesets" --input "$JSON"

echo
echo "Done. Verify with:"
echo "  gh api repos/$REPO/rulesets --jq '.[] | {id, name, enforcement}'"

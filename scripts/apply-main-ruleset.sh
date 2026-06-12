#!/usr/bin/env bash
#
# Apply the branch ruleset that protects `main` (the release branch).
#
# main is only lightly protected: it blocks branch deletion and force-pushes
# and enforces linear history, but does NOT require pull requests or status
# checks. That lets the release workflow's default GITHUB_TOKEN push the
# CHANGELOG commit directly (a normal linear fast-forward) with no PAT and no
# bypass actor — the same model as NoiXdev/inventorix.
#
# Usage:  bash scripts/apply-main-ruleset.sh
#
set -euo pipefail

REPO="NoiXdev/s3Manager"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JSON="$DIR/main-ruleset.json"

echo "Applying ruleset to $REPO from $JSON ..."

# Create the ruleset (fails if one named 'protect-main' already exists).
gh api -X POST "repos/$REPO/rulesets" --input "$JSON"

echo
echo "Done. Verify with:"
echo "  gh api repos/$REPO/rulesets --jq '.[] | {id, name, enforcement}'"

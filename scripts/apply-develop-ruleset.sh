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

# --- Verify the GitHub Actions integration id in the JSON -------------------
# The bypass actor with actor_type "Integration" must be the "GitHub Actions"
# app so the release workflow's CHANGELOG push to develop is not blocked.
# 15368 is the GitHub Actions app id on github.com. If your push from the
# release workflow ever gets rejected by the ruleset, confirm the id below
# matches what the repo UI shows under:
#   Settings -> Rules -> Rulesets -> protect-develop -> Bypass list -> "GitHub Actions"
echo "Applying ruleset to $REPO from $JSON ..."

# Create the ruleset (fails if one named 'protect-develop' already exists).
gh api -X POST "repos/$REPO/rulesets" --input "$JSON"

echo
echo "Done. Verify with:"
echo "  gh api repos/$REPO/rulesets --jq '.[] | {id, name, enforcement}'"

'use strict';

// Section mapping for the conventional-changelog "conventionalcommits" preset.
// Each visible commit type becomes a section in CHANGELOG.md; hidden ones are
// parsed (for version bumps) but kept out of the changelog.
module.exports = require('conventional-changelog-conventionalcommits')({
  types: [
    { type: 'feat', section: 'Features' },
    { type: 'fix', section: 'Bug Fixes' },
    { type: 'perf', section: 'Performance' },
    { type: 'refactor', section: 'Refactor' },
    { type: 'docs', section: 'Documentation' },
    { type: 'style', section: 'Styling' },
    { type: 'test', section: 'Testing' },
    { type: 'build', section: 'Build System' },
    { type: 'ci', section: 'CI/CD' },
    { type: 'revert', section: 'Reverts' },
    { type: 'chore', hidden: true },
  ],
});

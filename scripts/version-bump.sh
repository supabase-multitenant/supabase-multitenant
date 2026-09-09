#!/bin/bash
# Version bump script for indominus-dashboard
# Usage: ./scripts/version-bump.sh [patch|minor|major]

set -e

BUMP_TYPE=${1:-patch}

if [[ ! "$BUMP_TYPE" =~ ^(patch|minor|major)$ ]]; then
  echo "❌ Usage: $0 [patch|minor|major]"
  exit 1
fi

# Get current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
echo "📦 Current version: $CURRENT_VERSION"

# Bump version using npm (updates package.json and package-lock.json)
npm version $BUMP_TYPE --no-git-tag-version

# Get new version
NEW_VERSION=$(node -p "require('./package.json').version")
echo "✅ New version: $NEW_VERSION"

# Stage changes
git add package.json package-lock.json

# Commit with standard message
git commit -m "chore: bump version to $NEW_VERSION"

echo ""
echo "🎉 Version bumped to $NEW_VERSION and committed!"
echo ""
echo "To push and trigger Docker build:"
echo "  git push origin main"
echo ""
echo "To also create a git tag:"
echo "  git tag v$NEW_VERSION"
echo "  git push origin v$NEW_VERSION"

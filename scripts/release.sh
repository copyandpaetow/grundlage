#!/usr/bin/env bash
#one gate for both packages, then publishes the one named; npm run release and npm run release:plugin call it
set -euo pipefail

package=${1:-}
case $package in
	grundlage) directory=lib ;;
	vite-plugin-grundlage) directory=prerender-plugin ;;
	*)
		echo "release.sh expects grundlage or vite-plugin-grundlage, not \"$package\". Run npm run release or npm run release:plugin." >&2
		exit 1
		;;
esac

version=$(node -p "require('./$directory/package.json').version")

#npm prints nothing for a version it does not have
if [[ -n $(npm view "$package@$version" version 2>/dev/null || true) ]]; then
	echo "$package $version is already on npm. Bump it first: npm version minor -w $package" >&2
	exit 1
fi
if ! grep -q "^## $version\$" "$directory/CHANGELOG.md"; then
	echo "$directory/CHANGELOG.md has no \"## $version\" section. Rename \"## Unreleased\" to it." >&2
	exit 1
fi
if ! git diff --quiet HEAD; then
	echo "the working tree has uncommitted changes. Commit them first, so the release matches a commit." >&2
	exit 1
fi

npm run typecheck -w grundlage
npm run typecheck -w vite-plugin-grundlage
npm run lint
npm run format:check
npm run test:engines
npm run fuzz

npm publish -w "$package"

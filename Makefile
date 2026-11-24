# Roost: one extension, four parts under parts/<name>/. The root package.json is generated (make manifest).
VSCE = npx --yes @vscode/vsce
VERSION = $(shell node -p "require('./roost.json').version")
VSIX = roost-$(VERSION).vsix
EXT_ID = seanahn.roost-$(VERSION)
EXT_DIRS ?= $(HOME)/.vscode/extensions $(HOME)/.local/share/code-server/extensions $(HOME)/.vscode-server/extensions
PARTS = $(patsubst %/package-lock.json,%,$(wildcard parts/*/package-lock.json))

.PHONY: manifest deps test test-live install package test-package release release-test release-publish-check release-publish clean

manifest: ; node scripts/build-manifest.js

## Root: the runtime dependencies of every part. Each part with a lockfile (and Perch's audio): its own, for its tests
deps: manifest
	npm ci --silent
	@for p in $(PARTS); do echo "deps $$p"; (cd $$p && npm ci --silent) || exit 1; done
	@# Perch's audio companion is excluded from the .vsix; its tests (run by Perch's test-offline) need these
	cd parts/agents/audio && npm ci --silent

## Offline tests: Roost's own, then each part's, then the manifest is checked against the parts
test: export ROOST_TEST_HARNESS_STRICT_GH = 1
test:
	@for t in $(filter-out test/package.test.js,$(wildcard test/*.test.js)); do node $$t || exit 1; done
	$(MAKE) -C parts/agents test-offline
	$(MAKE) -C parts/teams test
	$(MAKE) -C parts/jira test
	$(MAKE) -C parts/pull-requests test
	node scripts/build-manifest.js --check

## Perch's tests, including one tiny live turn through each agent (uses your real logins)
test-live:
	$(MAKE) -C parts/agents test

## Symlink this checkout into every VS Code / code-server extension dir that exists
install: deps
	@for d in $(EXT_DIRS); do [ -d $$d ] || continue; rm -f $$d/seanahn.roost-*; ln -sfn "$(CURDIR)" $$d/$(EXT_ID) && echo "linked $$d/$(EXT_ID)"; done; true
	@echo "roost installed. Reload the window to activate."

## Build roost-<version>.vsix
package: manifest
	npm ci --silent
	$(VSCE) package

## Package, then check what the .vsix holds
test-package: package
	node test/package.test.js

## dist/: the .vsix and the stamped one-file installer (version and the .vsix's SHA-256 in, helper inlined)
release: package
	rm -rf dist && mkdir dist
	cp $(VSIX) dist/$(VSIX)
	sh installer/build-release.sh $(VERSION) dist/$(VSIX) dist

## make release, then the release tests (which fail, rather than skip, without dist/)
release-test: release
	ROOST_REQUIRE_DIST=1 python3 -m unittest installer/test/test_release.py

## Refuse to publish from a tree with uncommitted changes, or a HEAD not on origin: the release's tag is made at HEAD
release-publish-check:
	@[ -z "$$(git status --porcelain)" ] || { echo "the tree has uncommitted changes; commit them first"; exit 1; }
	@[ -n "$$(git branch -r --list 'origin/*' --contains HEAD)" ] || { echo "HEAD isn't on origin; push it first"; exit 1; }

## Publish dist/ as a GitHub release, tagged at HEAD. The owner's action: nothing in the build or the tests runs it
release-publish: release-publish-check
	@[ -f dist/roost-install.sh ] && [ -f dist/$(VSIX) ] || { echo "dist/ is missing; run make release"; exit 1; }
	@grep -q '^ROOST_VERSION="$(VERSION)"$$' dist/roost-install.sh || { echo "dist/ is stale (not $(VERSION)); run make release"; exit 1; }
	@sha=$$(cd dist && (sha256sum $(VSIX) 2> /dev/null || shasum -a 256 $(VSIX)) | cut -d' ' -f1); \
	  grep -q "^ROOST_SHA256=\"$$sha\"$$" dist/roost-install.sh || { echo "dist/ is stale (the .vsix doesn't match the installer's checksum); run make release"; exit 1; }; \
	  [ ! -f $(VSIX) ] || cmp -s $(VSIX) dist/$(VSIX) || { echo "dist/ is stale (differs from $(VSIX)); run make release"; exit 1; }
	@printf 'Roost %s\n\nInstall: curl -fsSL https://github.com/seanahn/roost/releases/latest/download/roost-install.sh | bash\n' \
	  "$(VERSION)" > dist/release-notes.md
	gh release create v$(VERSION) dist/roost-install.sh dist/$(VSIX) --repo seanahn/roost --title "Roost $(VERSION)" \
	  --target "$$(git rev-parse HEAD)" --notes-file dist/release-notes.md

clean:
	rm -rf dist
	rm -f roost-*.vsix

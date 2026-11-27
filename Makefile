# Agentic Works: one extension, four parts under parts/<name>/. The root package.json is generated (make manifest).
VSCE = npx --yes @vscode/vsce
VERSION = $(shell node -p "require('./agentic-works.json').version")
VSIX = agentic-works-$(VERSION).vsix
EXT_ID = agenticworks.agentic-works-$(VERSION)
EXT_DIRS ?= $(HOME)/.vscode/extensions $(HOME)/.local/share/code-server/extensions $(HOME)/.vscode-server/extensions
PARTS = $(patsubst %/package-lock.json,%,$(wildcard parts/*/package-lock.json))

.PHONY: manifest deps test test-live install package test-package release release-test release-publish-check release-publish release-site clean

manifest: ; node scripts/build-manifest.js

## Root: the runtime dependencies of every part. Each part with a lockfile (and Perch's audio): its own, for its tests
deps: manifest
	npm ci --silent
	@for p in $(PARTS); do echo "deps $$p"; (cd $$p && npm ci --silent) || exit 1; done
	@# Perch's audio companion is excluded from the .vsix; its tests (run by Perch's test-offline) need these
	cd parts/agents/audio && npm ci --silent

## Offline tests: Agentic Works' own, then each part's, then the manifest is checked against the parts
test: export AGENTIC_WORKS_TEST_HARNESS_STRICT_GH = 1
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
	@for d in $(EXT_DIRS); do [ -d $$d ] || continue; rm -f $$d/agenticworks.agentic-works-*; ln -sfn "$(CURDIR)" $$d/$(EXT_ID) && echo "linked $$d/$(EXT_ID)"; done; true
	@echo "Agentic Works installed. Reload the window to activate."

## Build agentic-works-<version>.vsix
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
	AGENTIC_WORKS_REQUIRE_DIST=1 python3 -m unittest installer/test/test_release.py

## Refuse to publish from a tree with uncommitted changes, or a HEAD not on origin: the release's tag is made at HEAD
release-publish-check:
	@[ -z "$$(git status --porcelain)" ] || { echo "the tree has uncommitted changes; commit them first"; exit 1; }
	@[ -n "$$(git branch -r --list 'origin/*' --contains HEAD)" ] || { echo "HEAD isn't on origin; push it first"; exit 1; }

## Publish dist/ as a GitHub release, tagged at HEAD. The owner's action: nothing in the build or the tests runs it
release-publish: release-publish-check
	@[ -f dist/agentic-works-install.sh ] && [ -f dist/$(VSIX) ] || { echo "dist/ is missing; run make release"; exit 1; }
	@grep -q '^AGENTIC_WORKS_VERSION="$(VERSION)"$$' dist/agentic-works-install.sh || { echo "dist/ is stale (not $(VERSION)); run make release"; exit 1; }
	@sha=$$(cd dist && (sha256sum $(VSIX) 2> /dev/null || shasum -a 256 $(VSIX)) | cut -d' ' -f1); \
	  grep -q "^AGENTIC_WORKS_SHA256=\"$$sha\"$$" dist/agentic-works-install.sh || { echo "dist/ is stale (the .vsix doesn't match the installer's checksum); run make release"; exit 1; }; \
	  [ ! -f $(VSIX) ] || cmp -s $(VSIX) dist/$(VSIX) || { echo "dist/ is stale (differs from $(VSIX)); run make release"; exit 1; }
	@printf 'Agentic Works %s\n\nInstall: curl -fsSL https://agenticworks.cloud/install | bash\n' \
	  "$(VERSION)" > dist/release-notes.md
	gh release create v$(VERSION) dist/agentic-works-install.sh dist/$(VSIX) --repo agenticworks-cloud/agentic-works --title "Agentic Works $(VERSION)" \
	  --target "$$(git rev-parse HEAD)" --notes-file dist/release-notes.md

## Copy dist/'s installer into the Pages site (a clone of agenticworks-cloud.github.io) as `install`, committed there,
## once it is byte for byte the published v$(VERSION) one (AGENTIC_WORKS_PUBLISHED_INSTALLER: a local copy, for the
## tests). Pushing the site is the owner's step, after release-publish
PUBLISHED_INSTALLER = https://github.com/agenticworks-cloud/agentic-works/releases/download/v$(VERSION)/agentic-works-install.sh
release-site:
	@[ -n "$(SITE)" ] && git -C "$(SITE)" rev-parse --git-dir > /dev/null 2>&1 || { echo "SITE= must name a clone of the Pages repo"; exit 1; }
	@grep -q '^AGENTIC_WORKS_VERSION="$(VERSION)"$$' dist/agentic-works-install.sh || { echo "dist/ is stale (not $(VERSION)); run make release"; exit 1; }
	@pub=$${AGENTIC_WORKS_PUBLISHED_INSTALLER:-}; tmp=""; \
	  if [ -z "$$pub" ]; then \
	    tmp=$$(mktemp) && pub=$$tmp; \
	    curl -fsSL -o "$$tmp" "$(PUBLISHED_INSTALLER)" || { rm -f "$$tmp"; echo "v$(VERSION) isn't published; run make release-publish first"; exit 1; }; \
	  fi; \
	  cmp -s "$$pub" dist/agentic-works-install.sh; same=$$?; [ -z "$$tmp" ] || rm -f "$$tmp"; \
	  [ "$$same" = 0 ] || { echo "dist/agentic-works-install.sh differs from the published v$(VERSION) one; copy the published one"; exit 1; }
	cp dist/agentic-works-install.sh "$(SITE)/install"
	git -C "$(SITE)" add install
	git -C "$(SITE)" diff --cached --quiet || git -C "$(SITE)" commit -q -m "install: Agentic Works $(VERSION)"

clean:
	rm -rf dist
	rm -f agentic-works-*.vsix

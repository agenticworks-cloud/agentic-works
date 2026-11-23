# Roost: one extension, four parts under parts/<name>/. The root package.json is generated (make manifest).
VSCE = npx --yes @vscode/vsce
VERSION = $(shell node -p "require('./roost.json').version")
VSIX = roost-$(VERSION).vsix
EXT_ID = seanahn.roost-$(VERSION)
EXT_DIRS ?= $(HOME)/.vscode/extensions $(HOME)/.local/share/code-server/extensions $(HOME)/.vscode-server/extensions
PARTS = $(patsubst %/package-lock.json,%,$(wildcard parts/*/package-lock.json))

.PHONY: manifest deps test test-live install package test-package clean

manifest: ; node scripts/build-manifest.js

## Root: the runtime dependencies of every part. Each part with a lockfile (and Perch's audio): its own, for its tests
deps: manifest
	npm install --silent
	@for p in $(PARTS); do echo "deps $$p"; (cd $$p && npm install --silent) || exit 1; done
	cd parts/perch/audio && npm install --silent

## Offline tests: Roost's own, then each part's, then the manifest is checked against the parts
test:
	@for t in $(filter-out test/package.test.js,$(wildcard test/*.test.js)); do node $$t || exit 1; done
	$(MAKE) -C parts/perch test-offline
	$(MAKE) -C parts/chirp test
	$(MAKE) -C parts/jay test
	$(MAKE) -C parts/kestrel test
	node scripts/build-manifest.js --check

## Perch's tests, including one tiny live turn through each agent (uses your real logins)
test-live:
	$(MAKE) -C parts/perch test

## Symlink this checkout into every VS Code / code-server extension dir that exists
install: deps
	@for d in $(EXT_DIRS); do [ -d $$d ] || continue; rm -f $$d/seanahn.roost-*; ln -sfn "$(CURDIR)" $$d/$(EXT_ID) && echo "linked $$d/$(EXT_ID)"; done; true
	@echo "roost installed. Reload the window to activate."

## Build roost-<version>.vsix
package: manifest
	npm install --silent
	$(VSCE) package

## Package, then check what the .vsix holds
test-package: package
	node test/package.test.js

clean:
	rm -f roost-*.vsix

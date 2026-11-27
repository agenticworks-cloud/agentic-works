#!/bin/sh
# build-release.sh <version> <vsix> <out-dir>: writes <out-dir>/agentic-works-install.sh from installer/agentic-works-install.sh with
# the version and the .vsix's lowercase SHA-256 stamped in and agentic-works-install-helper inlined as a here-document.
set -eu
[ $# = 3 ] || { echo "usage: $0 <version> <vsix> <out-dir>" >&2; exit 2; }
version=$1 vsix=$2 out=$3
here=$(cd "$(dirname "$0")" && pwd)
[ -f "$vsix" ] || { echo "no such file: $vsix" >&2; exit 1; }
if command -v sha256sum > /dev/null 2>&1; then
  sha=$(sha256sum "$vsix" | cut -d' ' -f1)
else
  sha=$(shasum -a 256 "$vsix" | cut -d' ' -f1)
fi
sha=$(printf '%s' "$sha" | tr 'A-F' 'a-f')
delim=AGENTIC_WORKS_INSTALL_HELPER_END
if grep -qx "$delim" "$here/agentic-works-install-helper"; then echo "helper contains $delim" >&2; exit 1; fi
mkdir -p "$out"
tmp=$(mktemp "$out/.agentic-works-install.XXXXXX")
trap 'rm -f "$tmp"' EXIT
awk -v version="$version" -v sha="$sha" -v helper="$here/agentic-works-install-helper" -v delim="$delim" '
  /^[ \t]*# @INLINED_HELPER@[ \t]*$/ {
    print "  INLINED_HELPER=$(mktemp \"${TMPDIR:-/tmp}/agentic-works-install-helper.XXXXXX\") || return 1"
    print "  cat > \"$INLINED_HELPER\" << '"'"'" delim "'"'"' || { rm -f \"$INLINED_HELPER\"; INLINED_HELPER=\"\"; return 1; }"
    while ((getline line < helper) > 0) print line
    print delim
    print "  return 0"
    next
  }
  { gsub(/@AGENTIC_WORKS_VERSION@/, version); gsub(/@AGENTIC_WORKS_SHA256@/, sha); print }
' "$here/agentic-works-install.sh" > "$tmp"
chmod 755 "$tmp"
mv "$tmp" "$out/agentic-works-install.sh"
trap - EXIT

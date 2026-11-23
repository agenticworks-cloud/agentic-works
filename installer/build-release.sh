#!/bin/sh
# build-release.sh <version> <vsix> <out-dir>: writes <out-dir>/roost-install.sh from installer/roost-install.sh with
# the version and the .vsix's lowercase SHA-256 stamped in and roost-install-helper inlined as a here-document.
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
delim=ROOST_INSTALL_HELPER_END
if grep -qx "$delim" "$here/roost-install-helper"; then echo "helper contains $delim" >&2; exit 1; fi
mkdir -p "$out"
tmp=$(mktemp "$out/.roost-install.XXXXXX")
trap 'rm -f "$tmp"' EXIT
awk -v version="$version" -v sha="$sha" -v helper="$here/roost-install-helper" -v delim="$delim" '
  /^[ \t]*# @INLINED_HELPER@[ \t]*$/ {
    print "  INLINED_HELPER=$(mktemp \"${TMPDIR:-/tmp}/roost-install-helper.XXXXXX\") || return 1"
    print "  cat > \"$INLINED_HELPER\" << '"'"'" delim "'"'"'"
    while ((getline line < helper) > 0) print line
    print delim
    print "  return 0"
    next
  }
  { gsub(/@ROOST_VERSION@/, version); gsub(/@ROOST_SHA256@/, sha); print }
' "$here/roost-install.sh" > "$tmp"
chmod 755 "$tmp"
mv "$tmp" "$out/roost-install.sh"
trap - EXIT

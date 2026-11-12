#!/bin/sh
# pre-push gate for sablectl/sablectl-cli.
#
# This repository is PUBLIC: a secret committed once is public permanently
# (forks, clones and caches keep it even after a history rewrite). This gate
# therefore blocks pushes to the wrong remote, secret-shaped files, credential
# patterns, attribution trailers and commits with the wrong identity.
#
# It is the inverse of a private-repository gate: that one refuses to push
# anywhere publicly readable, this one refuses to push anywhere other than
# the single repository this project is published from.
#
# Usage: scripts/pre-push-gate.sh [--dry-run] [--hook] [remote-name-or-url]
#   --dry-run  report all problems but always exit 0.
#   --hook     read the ref list from stdin, as git does when this runs as a
#              pre-push hook. Without it stdin is never read: a gate that
#              blocks on an empty stdin would hang any non-interactive
#              caller, which is precisely where it most needs to run.
set -eu

EXPECTED_EMAIL='355646062+sablectl@users.noreply.github.com'
DRY_RUN=0
FROM_HOOK=0
TARGET=''

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --hook) FROM_HOOK=1 ;;
    *) if [ -z "$TARGET" ]; then TARGET="$arg"; fi ;;
  esac
done

FAILS=0
refuse() {
  echo "REFUSED: $*" >&2
  FAILS=$((FAILS + 1))
}

[ -n "$TARGET" ] || TARGET=origin
case "$TARGET" in
  *://* | *@*:*) URL="$TARGET" ;;
  *) URL=$(git remote get-url --push "$TARGET" 2>/dev/null || true) ;;
esac
if [ -z "$URL" ]; then
  refuse "cannot resolve push URL for remote '$TARGET'"
fi

# 1. Remote check (exact repository, SSH or HTTPS).
case "$URL" in
  git@github.com:sablectl/sablectl-cli.git | \
    ssh://git@github.com/sablectl/sablectl-cli.git | \
    https://github.com/sablectl/sablectl-cli.git | \
    https://github.com/sablectl/sablectl-cli) ;;
  *) if [ -n "$URL" ]; then
      refuse "push remote '$URL' is not sablectl/sablectl-cli"
    fi ;;
esac

ZERO=0000000000000000000000000000000000000000
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT INT TERM

# Determine commit range(s) being pushed.
: >"$TMP/ranges"
if [ "$FROM_HOOK" -eq 1 ] && [ ! -t 0 ]; then
  while read -r _lref lsha _rref rsha; do
    [ -n "${lsha:-}" ] || continue
    [ "$lsha" = "$ZERO" ] && continue
    if [ "$rsha" = "$ZERO" ]; then
      echo "$lsha --not --remotes" >>"$TMP/ranges"
    else
      echo "$rsha..$lsha" >>"$TMP/ranges"
    fi
  done
fi
if [ ! -s "$TMP/ranges" ]; then
  if git rev-parse --verify -q '@{u}' >/dev/null 2>&1; then
    echo '@{u}..HEAD' >"$TMP/ranges"
  else
    echo 'HEAD --not --remotes' >"$TMP/ranges"
  fi
fi

: >"$TMP/commits"
while read -r range; do
  # shellcheck disable=SC2086
  git rev-list $range >>"$TMP/commits" 2>/dev/null || true
done <"$TMP/ranges"
sort -u "$TMP/commits" -o "$TMP/commits"

# 2. Secret-shaped filenames (tracked, staged, and in pushed commits).
{
  git ls-files
  git diff --cached --name-only
  while read -r c; do
    git diff-tree --no-commit-id --name-only -r --root "$c"
  done <"$TMP/commits"
} | sort -u >"$TMP/files"
while read -r f; do
  [ -n "$f" ] || continue
  b=${f##*/}
  case "$b" in
    .env | .env.* | *.pem | *.key | id_rsa* | id_ed25519* | *.p12 | *.keystore)
      case "$b" in
        .env.example | .env.sample | .env.template) ;;
        *) refuse "secret-shaped filename: $f" ;;
      esac
      ;;
  esac
done <"$TMP/files"

# 3. Credential patterns in content being pushed (added lines + staged).
PATTERN='-----BEGIN [A-Z ]*PRIVATE KEY-----|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|postgres(ql)?://[^[:space:]:/@]+:[^[:space:]@]+@'
{
  git diff --cached -U0 --no-color
  while read -r c; do
    git show --no-color --format= -U0 "$c"
  done <"$TMP/commits"
} | grep -E '^\+[^+]' | grep -E -e "$PATTERN" >"$TMP/hits" || true
if [ -s "$TMP/hits" ]; then
  refuse "credential pattern found in content to be pushed ($(wc -l <"$TMP/hits" | tr -d ' ') line(s), values withheld)"
fi

# 4 & 5. Trailers and identity.
while read -r c; do
  [ -n "$c" ] || continue
  short=$(git rev-parse --short "$c")
  if git log -1 --format=%B "$c" |
    grep -qiE '^(Co-authored-by|Generated-by|Assisted-by):'; then
    refuse "commit $short carries a Co-authored-by/Generated-by/Assisted-by trailer"
  fi
  ae=$(git log -1 --format=%ae "$c")
  ce=$(git log -1 --format=%ce "$c")
  if [ "$ae" != "$EXPECTED_EMAIL" ]; then
    refuse "commit $short author email '$ae' != $EXPECTED_EMAIL"
  fi
  if [ "$ce" != "$EXPECTED_EMAIL" ]; then
    refuse "commit $short committer email '$ce' != $EXPECTED_EMAIL"
  fi
done <"$TMP/commits"

if [ "$FAILS" -gt 0 ]; then
  echo "pre-push gate: $FAILS problem(s) found." >&2
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "pre-push gate: --dry-run, exiting 0." >&2
    exit 0
  fi
  exit 1
fi
echo "pre-push gate: OK"

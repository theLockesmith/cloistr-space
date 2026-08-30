#!/usr/bin/env bash
#
# Prove a rollout reached production, or say precisely why it cannot be proven.
#
# The instrument this replaces is reading the index-*.js filename off the served
# page. That cannot answer the question: the hash is content-derived, so an
# unchanged name covers BOTH "the rollout did not happen" AND "it happened and
# changed nothing", and a pod restart looks like both. Liveness and pod age are
# worse -- a healthy pod serving last week's bundle passes them.
#
# Every distinct outcome gets a distinct exit code, because the entire point is
# that "I could not tell" must never render as "confirmed".
#
#   0  MATCH        the served build is the commit you asked for
#   1  MISMATCH     production is serving a different commit
#   2  UNREACHABLE  network/DNS/TLS; says nothing about what is deployed
#   3  NO_VERSION   no version.json; the deployed build predates this probe
#   4  UNKNOWN      served build does not know its own commit
#
# Usage:
#   scripts/verify-deploy.sh                          # expect current HEAD
#   scripts/verify-deploy.sh --commit <sha>
#   scripts/verify-deploy.sh --url http://localhost:8080

set -uo pipefail

URL="https://space.cloistr.xyz"
EXPECTED=""

while [ $# -gt 0 ]; do
  case "$1" in
    --url) URL="$2"; shift 2 ;;
    --commit) EXPECTED="$2"; shift 2 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 64 ;;
  esac
done

if [ -z "$EXPECTED" ]; then
  EXPECTED="$(git rev-parse HEAD 2>/dev/null || true)"
fi
if [ -z "$EXPECTED" ]; then
  echo "FAIL: no expected commit given and not in a git repo" >&2
  exit 64
fi

# Cache-buster in the query as well as the header. version.json is not in
# nginx.conf's cached-asset regex so it already gets no-store, but a CDN or
# ingress in front of it has its own opinions and this costs nothing.
PROBE="${URL%/}/version.json?probe=$(date +%s)"

BODY="$(curl -fsS --max-time 15 -H 'Cache-Control: no-cache' "$PROBE" 2>/dev/null)"
CURL_RC=$?

if [ $CURL_RC -ne 0 ]; then
  # Separate "no such file" from "cannot reach host". Conflating them is how a
  # dead hostname gets reported as a missing feature.
  STATUS="$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$PROBE" 2>/dev/null)"
  if [ "$STATUS" = "404" ]; then
    echo "NO_VERSION: $URL has no version.json (HTTP 404)."
    echo "  The deployed build predates the version probe, so this cannot confirm"
    echo "  a rollout either way. Deploy a build that includes it, then re-run."
    exit 3
  fi
  echo "UNREACHABLE: could not fetch $PROBE (curl rc=$CURL_RC, http=${STATUS:-none})."
  echo "  This says NOTHING about what is deployed. Do not read it as stale."
  exit 2
fi

# An SPA rewrite answers /version.json with 200 and index.html, so a missing
# file does NOT arrive as a 404 -- this was found by running the probe against
# production, where the 404 branch above never fired and the result degraded to
# UNKNOWN. Checking that the body is actually JSON catches the real case.
case "$BODY" in
  '{'*) ;;
  *)
    echo "NO_VERSION: $URL answered /version.json with something that is not JSON."
    echo "  Almost certainly the SPA fallback serving index.html, which means the"
    echo "  deployed build predates the version probe. This cannot confirm a"
    echo "  rollout either way. Deploy a build that includes it, then re-run."
    exit 3
    ;;
esac

ACTUAL="$(printf '%s' "$BODY" | sed -n 's/.*"commit"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
BUILT="$(printf '%s' "$BODY" | sed -n 's/.*"builtAt"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
PIPE="$(printf '%s' "$BODY" | sed -n 's/.*"pipeline"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"

if [ -z "$ACTUAL" ] || [ "$ACTUAL" = "unknown" ]; then
  echo "UNKNOWN: $URL served a version.json with no usable commit."
  echo "  Body: $BODY"
  echo "  The build did not know its own identity, so this cannot confirm a rollout."
  exit 4
fi

if [ "$ACTUAL" = "$EXPECTED" ]; then
  echo "MATCH: $URL is serving ${ACTUAL:0:12}"
  echo "  built:    $BUILT"
  echo "  pipeline: $PIPE"
  exit 0
fi

echo "MISMATCH: $URL is serving a different build."
echo "  expected: ${EXPECTED:0:12}"
echo "  serving:  ${ACTUAL:0:12}"
echo "  built:    $BUILT"
echo "  pipeline: $PIPE"
echo "  The rollout has not reached production (or has not finished)."
exit 1

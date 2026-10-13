#!/bin/sh
set -e

# Translate OSC-style configuration (DATABASE_URL, REDIS_URL, S3_*, SMTP_*, ...)
# into PeerTube's PEERTUBE_* environment variables, then hand over to the
# upstream entrypoint.
SETUP_OUTPUT=$(node /app/osc-setup.mjs)
eval "$SETUP_OUTPUT"

exec /usr/local/bin/entrypoint.sh "$@"

#!/bin/sh
set -eu
: "${GAME_A_SERVER_URL:?Set the deployed Parcel Panic backend URL}"
: "${GAME_B_SERVER_URL:?Set the deployed Bumble Rally backend URL}"
(cd games/a && npm ci --ignore-scripts --no-audit --no-fund && BASE_PATH=/games/a/ VITE_GAME_SERVER_URL="$GAME_A_SERVER_URL" npm run build)
(cd games/b && npm ci --ignore-scripts --no-audit --no-fund && BASE_PATH=/games/b/ VITE_GAME_SERVER_URL="$GAME_B_SERVER_URL" npm run build)
node scripts/assemble.mjs

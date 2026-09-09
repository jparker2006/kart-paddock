#!/bin/sh
set -eu
: "${GAME_A_SERVER_URL:?Set the deployed Parcel Panic backend URL}"
: "${GAME_B_SERVER_URL:?Set the deployed Bumble Rally backend URL}"
(cd games/a && npm ci --ignore-scripts --no-audit --no-fund && BASE_PATH=/games/a/ VITE_GAME_SERVER_URL="$GAME_A_SERVER_URL" npm run build)
(cd games/b && npm ci --ignore-scripts --no-audit --no-fund && BASE_PATH=/games/b/ VITE_GAME_SERVER_URL="$GAME_B_SERVER_URL" npm run build)
: "${GAME_C_SERVER_URL:?Set the deployed Harvest Rush backend URL}"
(cd games/c && npm ci --ignore-scripts --no-audit --no-fund && npm run typecheck && BASE_PATH=/games/c/ VITE_GAME_SERVER_URL="$GAME_C_SERVER_URL" npm run build)
: "${GAME_D_SERVER_URL:?Set the deployed Cinder Peak Rally backend URL}"
(cd games/d && npm ci --ignore-scripts --no-audit --no-fund && BASE_PATH=/games/d/ VITE_GAME_SERVER_URL="$GAME_D_SERVER_URL" npm run build)
node scripts/assemble.mjs

#!/usr/bin/env bash
set -euo pipefail
cd /workspace/slaydrive-world
node -e "if(Number(process.versions.node.split('.')[0])!==24)throw Error('Use Node 24; see .nvmrc')"
npm ci --prefer-offline --no-audit --no-fund --cache /tmp/slaydrive-world-npm
npm run build
npm run build:adapter
npm test

#!/usr/bin/env bash

set -euo pipefail

KEYCHAIN_SERVICE="forklight.volcengine.api-key"
KEYCHAIN_ACCOUNT="$(id -un)"

if ! command -v security >/dev/null 2>&1; then
  echo "This setup script requires the macOS security command." >&2
  exit 1
fi

printf "Volcengine Coding Plan API Key: "
IFS= read -r -s VOLCENGINE_API_KEY
printf "\n"

if [[ -z "${VOLCENGINE_API_KEY}" ]]; then
  echo "API Key cannot be empty." >&2
  exit 1
fi

security add-generic-password \
  -U \
  -a "${KEYCHAIN_ACCOUNT}" \
  -s "${KEYCHAIN_SERVICE}" \
  -w "${VOLCENGINE_API_KEY}" >/dev/null

unset VOLCENGINE_API_KEY

echo "Saved the Volcengine Coding Plan key in macOS Keychain."
echo "Service: ${KEYCHAIN_SERVICE}"
echo "Account: ${KEYCHAIN_ACCOUNT}"
echo "The key was not written to ForkLight settings or the project directory."

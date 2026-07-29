#!/usr/bin/env bash

set -euo pipefail

KEYCHAIN_SERVICE="forklight.volcengine.api-key"

resolve_keychain_account() {
  local candidate
  local id_account=""
  id_account="$(id -un 2>/dev/null || true)"
  for candidate in "${USER:-}" "${LOGNAME:-}" "${id_account}"; do
    if [[ "${candidate}" =~ ^[A-Za-z0-9._-]{1,128}$ ]]; then
      printf '%s' "${candidate}"
      return 0
    fi
  done
  echo "Unable to resolve a safe local Keychain account." >&2
  return 1
}

KEYCHAIN_ACCOUNT="$(resolve_keychain_account)"

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

printf '%s\n' "${VOLCENGINE_API_KEY}" | security add-generic-password \
  -U \
  -a "${KEYCHAIN_ACCOUNT}" \
  -s "${KEYCHAIN_SERVICE}" \
  -T /usr/bin/security \
  -w >/dev/null

unset VOLCENGINE_API_KEY

echo "Saved the Volcengine Coding Plan key in macOS Keychain."
echo "Service: ${KEYCHAIN_SERVICE}"
echo "Account: ${KEYCHAIN_ACCOUNT}"
echo "The key was not written to ForkLight settings or the project directory."

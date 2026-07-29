#!/usr/bin/env bash

set -euo pipefail

provider_name="${1:-}"

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

keychain_account="$(resolve_keychain_account)"

case "${provider_name}" in
  deepseek)
    provider_label="DeepSeek"
    keychain_service="forklight.deepseek.api-key"
    ;;
  minimax)
    provider_label="MiniMax"
    keychain_service="forklight.minimax.api-key"
    ;;
  volcengine)
    provider_label="Volcengine Coding Plan"
    keychain_service="forklight.volcengine.api-key"
    ;;
  *)
    echo "Usage: $0 <deepseek|minimax|volcengine>" >&2
    exit 2
    ;;
esac

if ! command -v security >/dev/null 2>&1; then
  echo "This setup script requires the macOS security command." >&2
  exit 1
fi

printf "%s API Key: " "${provider_label}"
IFS= read -r -s provider_api_key
printf "\n"

if [[ -z "${provider_api_key}" ]]; then
  echo "API Key cannot be empty." >&2
  exit 1
fi

printf '%s\n' "${provider_api_key}" | security add-generic-password \
  -U \
  -a "${keychain_account}" \
  -s "${keychain_service}" \
  -T /usr/bin/security \
  -w >/dev/null

unset provider_api_key

if ! security find-generic-password \
  -a "${keychain_account}" \
  -s "${keychain_service}" \
  -w >/dev/null 2>&1; then
  echo "The Keychain item was saved but is not readable by this process." >&2
  echo "Re-run the command and approve any macOS Keychain access prompt." >&2
  exit 1
fi

echo "Saved and verified the ${provider_label} key in macOS Keychain."
echo "Service: ${keychain_service}"
echo "Account: ${keychain_account}"
echo "The key was not written to ForkLight settings or the project directory."

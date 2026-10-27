#!/usr/bin/env bash
# Install Playwright browser binaries, then OS packages with a hard bound.
# GitHub-hosted Ubuntu sometimes trickles packages from azure.archive.ubuntu.com
# so apt never times out and the job is cancelled at timeout-minutes.
# See: https://github.com/actions/runner-images/issues/11347
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <browser> [browser...]" >&2
  exit 2
fi

browsers=("$@")
export DEBIAN_FRONTEND=noninteractive

npx playwright install "${browsers[@]}"

install_deps() {
  local seconds=$1
  sudo timeout --signal=KILL --kill-after=15s "${seconds}" \
    env PATH="${PATH}" DEBIAN_FRONTEND=noninteractive \
    npx playwright install-deps "${browsers[@]}"
}

if install_deps 180; then
  exit 0
fi

echo "::warning::playwright install-deps timed out or failed; retrying without Azure apt mirror"

if ! sudo dpkg --configure -a; then
  echo "::warning::dpkg --configure -a failed; continuing to retry install-deps"
fi
sudo pkill -9 apt-get || true
sudo pkill -9 apt || true
sleep 2

if [[ -f /etc/apt/apt-mirrors.txt ]]; then
  sudo sed -i '/azure.archive.ubuntu.com/d' /etc/apt/apt-mirrors.txt || true
fi

sudo find /etc/apt -type f \( -name '*.list' -o -name '*.sources' \) -print0 \
  | sudo xargs -0 --no-run-if-empty sed -i 's/azure.archive.ubuntu.com/archive.ubuntu.com/g' \
  || true

sudo timeout --signal=KILL --kill-after=15s 300 \
  env PATH="${PATH}" DEBIAN_FRONTEND=noninteractive \
  npx playwright install-deps "${browsers[@]}"

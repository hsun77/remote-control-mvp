#!/usr/bin/env bash
set -euo pipefail

KICKSTART="/System/Library/CoreServices/RemoteManagement/ARDAgent.app/Contents/Resources/kickstart"

if [[ ! -x "$KICKSTART" ]]; then
  echo "Cannot find Apple Remote Management kickstart tool: $KICKSTART" >&2
  exit 1
fi

echo "This enables Apple Remote Management / Screen Sharing on this Mac."
echo "Use it through Tailscale only unless you also configure a firewall."
echo
read -rsp "Set a VNC password for Windows clients: " VNC_PASSWORD
echo

if [[ ${#VNC_PASSWORD} -lt 6 ]]; then
  echo "VNC password should be at least 6 characters." >&2
  exit 1
fi

sudo "$KICKSTART" \
  -activate \
  -configure \
  -access -on \
  -allowAccessFor -allUsers \
  -privs -all \
  -clientopts \
  -setvnclegacy -vnclegacy yes \
  -setvncpw -vncpw "$VNC_PASSWORD" \
  -restart -agent

sudo launchctl enable system/com.apple.screensharing 2>/dev/null || true
sudo launchctl bootstrap system /System/Library/LaunchDaemons/com.apple.screensharing.plist 2>/dev/null || true
sudo launchctl kickstart -k system/com.apple.screensharing 2>/dev/null || true

TAILSCALE_IP="$(tailscale ip -4 2>/dev/null || true)"
echo
echo "Done."
if [[ -n "$TAILSCALE_IP" ]]; then
  echo "Connect from Windows VNC Viewer to: ${TAILSCALE_IP}:5900"
else
  echo "Connect from Windows VNC Viewer to this Mac's Tailscale IP on port 5900."
fi

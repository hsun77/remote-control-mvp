const $ = (id) => document.getElementById(id);

const statusEl = $("status");
const deviceIdEl = $("deviceId");
const serverUrlEl = $("serverUrl");
const turnUrlEl = $("turnUrl");
const turnUserEl = $("turnUser");
const turnPasswordEl = $("turnPassword");
const roomCodeEl = $("roomCode");
const joinCodeEl = $("joinCode");
const shareBtn = $("shareBtn");
const connectBtn = $("connectBtn");
const disconnectBtn = $("disconnectBtn");
const testInputBtn = $("testInputBtn");
const translateShortcutsEl = $("translateShortcuts");
const autoShareEl = $("autoShare");
const sourcesEl = $("sources");
const remoteVideo = $("remoteVideo");
const localPreview = $("localPreview");
const stage = document.querySelector(".stage");

remoteVideo.tabIndex = 0;

let ws = null;
let pc = null;
let controlChannel = null;
let localStream = null;
let selectedSource = null;
let role = null;
let lastMoveSentAt = 0;
let lastNativeInputError = "";
let deviceId = "";
let controlSeq = 0;
let controlSentCount = 0;
let controlReceivedCount = 0;
let controlAckCount = 0;
let inputCaptured = false;
let lastControlStatusAt = 0;
let autoShareStarted = false;
const shortcutSettingKey = "remote-control.translate-shortcuts";
const autoShareSettingKey = "remote-control.auto-share";
const savedFieldKeys = {
  serverUrl: "remote-control.server-url",
  turnUrl: "remote-control.turn-url",
  turnUser: "remote-control.turn-user",
  turnPassword: "remote-control.turn-password"
};

function currentPlatform() {
  const platform = navigator.platform.toLowerCase();
  if (platform.includes("mac")) return "darwin";
  if (platform.includes("win")) return "win32";
  if (platform.includes("linux")) return "linux";
  return platform || "unknown";
}

function loadShortcutSettings() {
  const saved = window.localStorage.getItem(shortcutSettingKey);
  translateShortcutsEl.checked = saved === null ? true : saved === "true";
}

function saveShortcutSettings() {
  window.localStorage.setItem(shortcutSettingKey, String(translateShortcutsEl.checked));
}

function loadSavedSettings() {
  loadShortcutSettings();
  autoShareEl.checked = window.localStorage.getItem(autoShareSettingKey) !== "false";

  const fields = { serverUrl: serverUrlEl, turnUrl: turnUrlEl, turnUser: turnUserEl, turnPassword: turnPasswordEl };
  for (const [name, element] of Object.entries(fields)) {
    const saved = window.localStorage.getItem(savedFieldKeys[name]);
    if (saved !== null) element.value = saved;
  }
}

function saveNetworkSettings() {
  window.localStorage.setItem(savedFieldKeys.serverUrl, serverUrlEl.value.trim());
  window.localStorage.setItem(savedFieldKeys.turnUrl, turnUrlEl.value.trim());
  window.localStorage.setItem(savedFieldKeys.turnUser, turnUserEl.value.trim());
  window.localStorage.setItem(savedFieldKeys.turnPassword, turnPasswordEl.value);
}

function saveAutoShareSetting() {
  window.localStorage.setItem(autoShareSettingKey, String(autoShareEl.checked));
}

function getIceServers() {
  const servers = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun.cloudflare.com:3478" }
  ];
  const turnUrl = turnUrlEl.value.trim();
  const username = turnUserEl.value.trim();
  const credential = turnPasswordEl.value;

  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username,
      credential
    });
  }

  return servers;
}

function setStatus(text) {
  statusEl.textContent = text;
}

function setConnectedState(connected) {
  shareBtn.disabled = connected && role === "host";
  connectBtn.disabled = connected && role === "viewer";
  disconnectBtn.disabled = !connected;
}

function sendSignal(message) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify(message));
}

function closeEverything() {
  if (controlChannel) {
    controlChannel.close();
    controlChannel = null;
  }
  if (pc) {
    pc.close();
    pc = null;
  }
  if (ws) {
    ws.close();
    ws = null;
  }
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
    localStream = null;
  }
  localPreview.srcObject = null;
  remoteVideo.srcObject = null;
  stage.classList.remove("has-local", "has-remote");
  role = null;
  setConnectedState(false);
  setStatus("Ready");
}

function connectSignaling() {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(serverUrlEl.value.trim());
    const timer = window.setTimeout(() => {
      socket.close();
      reject(new Error("Signaling connection timed out"));
    }, 8000);

    socket.addEventListener("open", () => {
      window.clearTimeout(timer);
      ws = socket;
      resolve(socket);
    });

    socket.addEventListener("error", () => {
      window.clearTimeout(timer);
      reject(new Error("Could not connect to signaling server"));
    });

    socket.addEventListener("close", () => {
      if (ws === socket) {
        setStatus("Signaling disconnected");
      }
    });

    socket.addEventListener("message", (event) => handleSignal(JSON.parse(event.data)));
  });
}

function createPeerConnection() {
  const peer = new RTCPeerConnection({ iceServers: getIceServers() });

  peer.onicecandidate = (event) => {
    if (event.candidate) {
      sendSignal({ type: "ice-candidate", candidate: event.candidate });
    }
  };

  peer.onconnectionstatechange = () => {
    setStatus(`Peer connection: ${peer.connectionState}`);
    if (peer.connectionState === "connected") {
      setConnectedState(true);
    }
    if (["closed", "failed", "disconnected"].includes(peer.connectionState)) {
      if (peer.connectionState !== "closed") setStatus(`Peer connection: ${peer.connectionState}`);
    }
  };

  peer.ontrack = (event) => {
    const [stream] = event.streams;
    remoteVideo.srcObject = stream;
    stage.classList.add("has-remote");
    remoteVideo.focus();
  };

  return peer;
}

function setControlStatus(text, immediate = false) {
  const now = performance.now();
  if (!immediate && now - lastControlStatusAt < 500) return;
  lastControlStatusAt = now;
  setStatus(text);
}

function wireControlChannel(channel, mode) {
  controlChannel = channel;
  controlChannel.onopen = () => {
    setControlStatus("Control channel encrypted and ready", true);
    if (mode === "viewer") {
      remoteVideo.focus();
    }
  };
  controlChannel.onmessage = (event) => handleControlMessage(event.data);
  controlChannel.onerror = () => setControlStatus("Control channel error", true);
  controlChannel.onclose = () => setControlStatus("Control channel closed", true);
}

function createControlChannel(mode) {
  wireControlChannel(
    pc.createDataChannel("control", {
      negotiated: true,
      id: 0,
      ordered: true
    }),
    mode
  );
}

async function startHostPeer() {
  pc = createPeerConnection();
  createControlChannel("host");

  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }

  const offer = await pc.createOffer({
    offerToReceiveVideo: false,
    offerToReceiveAudio: false
  });
  await pc.setLocalDescription(offer);
  sendSignal({ type: "offer", offer });
}

async function handleSignal(message) {
  if (message.type === "room-created") {
    roomCodeEl.textContent = message.code;
    setStatus("Waiting for viewer");
    return;
  }

  if (message.type === "room-joined") {
    setStatus("Joined room, waiting for host offer");
    return;
  }

  if (message.type === "peer-joined") {
    setStatus("Viewer joined, creating encrypted WebRTC session");
    await startHostPeer();
    return;
  }

  if (message.type === "offer") {
    pc = createPeerConnection();
    createControlChannel("viewer");

    await pc.setRemoteDescription(message.offer);
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    sendSignal({ type: "answer", answer });
    return;
  }

  if (message.type === "answer") {
    await pc.setRemoteDescription(message.answer);
    setStatus("Encrypted WebRTC session established");
    return;
  }

  if (message.type === "ice-candidate") {
    if (pc && message.candidate) {
      await pc.addIceCandidate(message.candidate);
    }
    return;
  }

  if (message.type === "control-event") {
    await handleControlMessage(JSON.stringify(message.event), "signal");
    return;
  }

  if (message.type === "control-ack") {
    await handleControlMessage(JSON.stringify(message.ack), "signal");
    return;
  }

  if (message.type === "peer-left") {
    setStatus("Peer left");
    closeEverything();
    return;
  }

  if (message.type === "error") {
    setStatus(message.error);
  }
}

async function loadSources() {
  let sources = [];
  try {
    sources = await window.remoteDesktop.listSources();
  } catch (error) {
    selectedSource = null;
    sourcesEl.replaceChildren();
    throw error;
  }

  selectedSource = sources[0] ?? null;
  sourcesEl.replaceChildren(
    ...sources.map((source) => {
      const item = document.createElement("button");
      item.className = `source${source.id === selectedSource?.id ? " selected" : ""}`;
      item.type = "button";
      const thumb = source.thumbnail
        ? `<img alt="" src="${source.thumbnail}" />`
        : `<div class="source-placeholder">Pick</div>`;
      item.innerHTML = `${thumb}<span>${source.name}</span>`;
      item.addEventListener("click", () => {
        selectedSource = source;
        [...sourcesEl.children].forEach((child) => child.classList.remove("selected"));
        item.classList.add("selected");
      });
      return item;
    })
  );
}

async function refreshSourcesForShare() {
  if (selectedSource) return true;
  await loadSources();
  return Boolean(selectedSource);
}

async function getDesktopStream() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Desktop sharing is not available in this runtime.");
  }

  return navigator.mediaDevices.getDisplayMedia({
    audio: false,
    video: true
  });
}

async function shareThisComputer(options = {}) {
  if (role === "host" && localStream) return;
  if (!(await refreshSourcesForShare())) {
    return;
  }

  await window.remoteDesktop.captureMode(options.unattended ? "direct" : "picker");

  saveNetworkSettings();
  role = "host";
  setConnectedState(true);
  setStatus(options.unattended ? "Starting unattended sharing" : "Opening screen picker");

  try {
    localStream = await getDesktopStream();
    localPreview.srcObject = localStream;
    stage.classList.add("has-local");

    await connectSignaling();
    sendSignal({ type: "create-room", deviceId });
  } catch (error) {
    closeEverything();
    setStatus(error.message);
  }
}

async function connectToComputer() {
  const code = joinCodeEl.value.trim().toUpperCase();
  if (!/^(\d{6}|RC-[A-Z0-9]{4}-[A-Z0-9]{4})$/.test(code)) {
    setStatus("Enter a 6 digit room code or device ID");
    return;
  }

  if (role === "host") {
    closeEverything();
  }

  saveNetworkSettings();
  role = "viewer";
  setConnectedState(true);
  setStatus("Connecting to signaling server");

  try {
    await connectSignaling();
    sendSignal({ type: "join-room", code, deviceId });
  } catch (error) {
    closeEverything();
    setStatus(error.message);
  }
}

async function maybeAutoShare() {
  if (autoShareStarted || !autoShareEl.checked || !deviceId) return;
  autoShareStarted = true;
  window.setTimeout(() => {
    if (!role && autoShareEl.checked) {
      shareThisComputer({ unattended: true });
    }
  }, 700);
}

function normalizeVideoPoint(event) {
  const rect = remoteVideo.getBoundingClientRect();
  const videoWidth = remoteVideo.videoWidth || rect.width;
  const videoHeight = remoteVideo.videoHeight || rect.height;
  const videoAspect = videoWidth / videoHeight;
  const rectAspect = rect.width / rect.height;

  let drawnWidth = rect.width;
  let drawnHeight = rect.height;
  let offsetX = 0;
  let offsetY = 0;

  if (rectAspect > videoAspect) {
    drawnWidth = rect.height * videoAspect;
    offsetX = (rect.width - drawnWidth) / 2;
  } else {
    drawnHeight = rect.width / videoAspect;
    offsetY = (rect.height - drawnHeight) / 2;
  }

  const x = (event.clientX - rect.left - offsetX) / drawnWidth;
  const y = (event.clientY - rect.top - offsetY) / drawnHeight;

  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y))
  };
}

function sendControl(event) {
  if (role !== "viewer") return;
  controlSeq += 1;
  controlSentCount += 1;
  const payload = {
    ...event,
    seq: controlSeq,
    sourcePlatform: currentPlatform(),
    translateShortcuts: translateShortcutsEl.checked
  };
  if (ws?.readyState === WebSocket.OPEN) {
    sendSignal({ type: "control-event", event: payload });
  } else if (controlChannel?.readyState === "open") {
    controlChannel.send(JSON.stringify(payload));
  } else {
    setControlStatus("Control transport not ready", true);
    return;
  }
  if (event.type !== "mouseMove") {
    setControlStatus(`Sent ${event.type} to remote Mac`, true);
  }
}

function attachViewerInput() {
  stage.addEventListener("pointerdown", (event) => {
    if (role !== "viewer") return;
    inputCaptured = true;
    remoteVideo.focus();
    try {
      stage.setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is a convenience, not required for remote control.
    }
    event.preventDefault();
    sendControl({
      type: "mouseDown",
      button: event.button,
      buttons: event.buttons,
      ...normalizeVideoPoint(event)
    });
  });

  stage.addEventListener("pointermove", (event) => {
    if (role !== "viewer") return;
    const now = performance.now();
    if (now - lastMoveSentAt < 16) return;
    lastMoveSentAt = now;
    sendControl({
      type: "mouseMove",
      buttons: event.buttons,
      ...normalizeVideoPoint(event)
    });
  });

  stage.addEventListener("pointerup", (event) => {
    if (role !== "viewer") return;
    inputCaptured = true;
    try {
      stage.releasePointerCapture?.(event.pointerId);
    } catch {
      // The pointer may already be released by the OS.
    }
    sendControl({
      type: "mouseUp",
      button: event.button,
      buttons: event.buttons,
      ...normalizeVideoPoint(event)
    });
    event.preventDefault();
  });

  stage.addEventListener("contextmenu", (event) => {
    if (role !== "viewer") return;
    event.preventDefault();
  });

  stage.addEventListener(
    "wheel",
    (event) => {
      if (role !== "viewer") return;
      inputCaptured = true;
      remoteVideo.focus();
      event.preventDefault();
      sendControl({
        type: "wheel",
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        ...normalizeVideoPoint(event)
      });
    },
    { passive: false }
  );

  window.addEventListener("keydown", (event) => {
    if (role !== "viewer" || !inputCaptured) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
    event.preventDefault();
    sendControl({
      type: "keyDown",
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey
    });
  });

  window.addEventListener("keyup", (event) => {
    if (role !== "viewer" || !inputCaptured) return;
    if (["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) return;
    event.preventDefault();
    sendControl({
      type: "keyUp",
      key: event.key,
      code: event.code,
      ctrlKey: event.ctrlKey,
      altKey: event.altKey,
      shiftKey: event.shiftKey,
      metaKey: event.metaKey
    });
  });
}

async function handleControlMessage(raw, transport = "datachannel") {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  if (message.type === "controlAck") {
    controlAckCount += 1;
    if (!message.ok) {
      setControlStatus(message.error || "Remote input injection failed", true);
      return;
    }
    setControlStatus(
      `Remote control active: sent ${controlSentCount}, Mac received ${message.received}`,
      message.eventType !== "mouseMove"
    );
    return;
  }

  controlReceivedCount += 1;
  const result = await window.remoteDesktop.sendNativeInput(message);
  const ack = {
    type: "controlAck",
    ok: result.ok,
    error: result.error || "",
    eventType: message.type,
    seq: message.seq,
    received: controlReceivedCount
  };

  if (transport === "signal" && ws?.readyState === WebSocket.OPEN) {
    sendSignal({ type: "control-ack", ack });
  } else if (controlChannel?.readyState === "open") {
    controlChannel.send(JSON.stringify(ack));
  }
  if (!result.ok && result.error && result.error !== lastNativeInputError) {
    lastNativeInputError = result.error;
    const details = result.code === undefined ? "" : ` (exit ${result.code})`;
    setStatus(`${result.error}${details}`);
  } else if (result.ok) {
    lastNativeInputError = "";
    setControlStatus(
      `Mac input OK: received ${controlReceivedCount} events`,
      message.type !== "mouseMove"
    );
  }
}

async function testLocalInput() {
  setStatus("Testing local input helper");
  const status = await window.remoteDesktop.nativeInputStatus();
  if (!status.ok) {
    setStatus(status.error || "Enable Remote Control MVP in Accessibility, then restart the app");
    return;
  }

  const points = [
    { x: 0.48, y: 0.5 },
    { x: 0.52, y: 0.5 },
    { x: 0.5, y: 0.5 }
  ];

  for (const point of points) {
    const result = await window.remoteDesktop.sendNativeInput({
      type: "mouseMove",
      ...point
    });
    if (!result.ok) {
      const details = result.code === undefined ? "" : ` (exit ${result.code})`;
      setStatus(`${result.error || "Local input helper failed"}${details}`);
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }

  setStatus("Local input helper OK");
}

shareBtn.addEventListener("click", shareThisComputer);
connectBtn.addEventListener("click", connectToComputer);
testInputBtn.addEventListener("click", testLocalInput);
translateShortcutsEl.addEventListener("change", saveShortcutSettings);
autoShareEl.addEventListener("change", () => {
  saveAutoShareSetting();
  maybeAutoShare();
});
[serverUrlEl, turnUrlEl, turnUserEl, turnPasswordEl].forEach((element) => {
  element.addEventListener("change", saveNetworkSettings);
});
disconnectBtn.addEventListener("click", () => {
  sendSignal({ type: "leave" });
  closeEverything();
});

window.addEventListener("beforeunload", closeEverything);
window.addEventListener("focus", () => {
  if (!localStream) loadSources().catch((error) => setStatus(error.message));
});
attachViewerInput();
loadSavedSettings();
window.remoteDesktop
  .deviceId()
  .then((id) => {
    deviceId = id;
    deviceIdEl.textContent = id;
    maybeAutoShare();
  })
  .catch((error) => setStatus(error.message));
loadSources()
  .then(() => maybeAutoShare())
  .catch((error) => setStatus(error.message));

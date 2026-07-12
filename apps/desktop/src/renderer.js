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
  shareBtn.disabled = connected;
  connectBtn.disabled = connected;
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

async function startHostPeer() {
  pc = createPeerConnection();

  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }

  controlChannel = pc.createDataChannel("control", { ordered: false, maxRetransmits: 0 });
  controlChannel.onmessage = (event) => handleControlMessage(event.data);

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
    pc.ondatachannel = (event) => {
      controlChannel = event.channel;
      controlChannel.onopen = () => setStatus("Control channel encrypted and ready");
    };

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

  setStatus("Refreshing screen sources");
  try {
    await loadSources();
  } catch (error) {
    setStatus(error.message);
    return false;
  }

  if (!selectedSource) {
    setStatus("No screen source available. Enable Screen Recording, then reopen this app or click Share again.");
    return false;
  }

  return true;
}

async function getDesktopStream(sourceId) {
  if (sourceId === "__picker__") {
    if (!navigator.mediaDevices?.getDisplayMedia) {
      throw new Error("Screen picker is unavailable in this Electron build.");
    }

    return navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: {
        frameRate: 30
      }
    });
  }

  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      mandatory: {
        chromeMediaSource: "desktop",
        chromeMediaSourceId: sourceId,
        maxFrameRate: 30
      }
    }
  });
}

async function shareThisComputer() {
  if (!(await refreshSourcesForShare())) {
    return;
  }

  role = "host";
  setConnectedState(true);
  setStatus("Opening screen capture");

  try {
    localStream = await getDesktopStream(selectedSource.id);
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
  const code = joinCodeEl.value.trim();
  if (!/^\d{6}$/.test(code)) {
    setStatus("Enter a 6 digit room code");
    return;
  }

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
  if (role !== "viewer" || !controlChannel || controlChannel.readyState !== "open") return;
  controlChannel.send(JSON.stringify(event));
}

function attachViewerInput() {
  remoteVideo.addEventListener("mousemove", (event) => {
    const now = performance.now();
    if (now - lastMoveSentAt < 16) return;
    lastMoveSentAt = now;
    sendControl({ type: "mouseMove", ...normalizeVideoPoint(event) });
  });

  remoteVideo.addEventListener("mousedown", (event) => {
    remoteVideo.focus();
    event.preventDefault();
    sendControl({
      type: "mouseDown",
      button: event.button,
      ...normalizeVideoPoint(event)
    });
  });

  remoteVideo.addEventListener("mouseup", (event) => {
    event.preventDefault();
    sendControl({
      type: "mouseUp",
      button: event.button,
      ...normalizeVideoPoint(event)
    });
  });

  remoteVideo.addEventListener(
    "wheel",
    (event) => {
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

  remoteVideo.addEventListener("keydown", (event) => {
    if (role !== "viewer") return;
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

  remoteVideo.addEventListener("keyup", (event) => {
    if (role !== "viewer") return;
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

async function handleControlMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch {
    return;
  }

  const result = await window.remoteDesktop.sendNativeInput(message);
  if (!result.ok && result.error && result.error !== lastNativeInputError) {
    lastNativeInputError = result.error;
    setStatus(result.error);
  }
}

shareBtn.addEventListener("click", shareThisComputer);
connectBtn.addEventListener("click", connectToComputer);
disconnectBtn.addEventListener("click", () => {
  sendSignal({ type: "leave" });
  closeEverything();
});

window.addEventListener("beforeunload", closeEverything);
window.addEventListener("focus", () => {
  if (!localStream) loadSources().catch((error) => setStatus(error.message));
});
attachViewerInput();
window.remoteDesktop
  .deviceId()
  .then((id) => {
    deviceId = id;
    deviceIdEl.textContent = id;
  })
  .catch((error) => setStatus(error.message));
loadSources().catch((error) => setStatus(error.message));

import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import { WebSocketServer } from "ws";

const PORT = Number(process.env.PORT ?? 4141);
const TLS_KEY_FILE = process.env.TLS_KEY_FILE;
const TLS_CERT_FILE = process.env.TLS_CERT_FILE;

const rooms = new Map();

function makeCode() {
  for (let i = 0; i < 20; i += 1) {
    const code = String(Math.floor(100000 + Math.random() * 900000));
    if (!rooms.has(code)) return code;
  }
  throw new Error("Could not allocate room code");
}

function send(ws, message) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function getPeer(room, ws) {
  if (!room) return null;
  return ws === room.host ? room.viewer : room.host;
}

function leaveCurrentRoom(ws) {
  if (!ws.roomCode) return;
  const room = rooms.get(ws.roomCode);
  if (!room) return;

  const peer = getPeer(room, ws);
  if (peer) {
    send(peer, { type: "peer-left" });
  }

  if (room.host === ws || !room.host) {
    rooms.delete(ws.roomCode);
  } else if (room.viewer === ws) {
    room.viewer = null;
  }

  ws.roomCode = null;
  ws.role = null;
}

const server =
  TLS_KEY_FILE && TLS_CERT_FILE
    ? https.createServer({
        key: fs.readFileSync(TLS_KEY_FILE),
        cert: fs.readFileSync(TLS_CERT_FILE)
      })
    : http.createServer();

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: "error", error: "Invalid JSON message" });
      return;
    }

    if (message.type === "create-room") {
      leaveCurrentRoom(ws);
      const code = makeCode();
      rooms.set(code, { host: ws, viewer: null, createdAt: Date.now() });
      ws.roomCode = code;
      ws.role = "host";
      send(ws, { type: "room-created", code });
      return;
    }

    if (message.type === "join-room") {
      leaveCurrentRoom(ws);
      const room = rooms.get(String(message.code ?? ""));
      if (!room || !room.host) {
        send(ws, { type: "error", error: "Room not found" });
        return;
      }
      if (room.viewer) {
        send(ws, { type: "error", error: "Room already has a viewer" });
        return;
      }
      room.viewer = ws;
      ws.roomCode = message.code;
      ws.role = "viewer";
      send(ws, { type: "room-joined", code: message.code });
      send(room.host, { type: "peer-joined" });
      return;
    }

    if (message.type === "offer" || message.type === "answer" || message.type === "ice-candidate") {
      const room = rooms.get(ws.roomCode);
      const peer = getPeer(room, ws);
      if (!peer) {
        send(ws, { type: "error", error: "No peer in room" });
        return;
      }
      send(peer, message);
      return;
    }

    if (message.type === "leave") {
      leaveCurrentRoom(ws);
      send(ws, { type: "left" });
      return;
    }

    send(ws, { type: "error", error: `Unsupported message type: ${message.type}` });
  });

  ws.on("close", () => leaveCurrentRoom(ws));
});

server.listen(PORT, () => {
  const scheme = TLS_KEY_FILE && TLS_CERT_FILE ? "wss" : "ws";
  console.log(`Signaling server listening on ${scheme}://0.0.0.0:${PORT}`);
});

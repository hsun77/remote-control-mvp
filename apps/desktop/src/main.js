import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");
let inputHelper = null;
let lastInputHelperError = "";

function readOrCreateDeviceId() {
  const file = path.join(app.getPath("userData"), "device.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (typeof parsed.deviceId === "string" && /^RC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(parsed.deviceId)) {
      return parsed.deviceId;
    }
  } catch {
    // Create the id below.
  }

  fs.mkdirSync(path.dirname(file), { recursive: true });
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let token = "";
  for (let i = 0; i < 8; i += 1) {
    token += alphabet[crypto.randomInt(alphabet.length)];
  }
  const deviceId = `RC-${token.slice(0, 4)}-${token.slice(4)}`;
  fs.writeFileSync(file, JSON.stringify({ deviceId, createdAt: new Date().toISOString() }, null, 2));
  return deviceId;
}

function helperPath() {
  const exe = process.platform === "win32" ? "native-input-helper.exe" : "native-input-helper";
  if (app.isPackaged) {
    return path.join(process.resourcesPath, exe);
  }
  return path.join(projectRoot, "native-input-helper", "target", "release", exe);
}

function setupDisplayMedia() {
  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return permission === "media";
  });

  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });

  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ["screen"],
          thumbnailSize: { width: 1, height: 1 }
        });
        const screenSource = sources.find((source) => source.id.startsWith("screen:")) ?? sources[0];
        callback({ video: screenSource });
      } catch (error) {
        console.error(`display media request failed: ${error.message}`);
        callback({});
      }
    },
    { useSystemPicker: process.platform === "darwin" }
  );
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#101418",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  setupDisplayMedia();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("desktop:list-sources", async () => {
  return [
    {
      id: "__display_media__",
      name: "Entire desktop",
      displayId: "",
      thumbnail: ""
    }
  ];
});

ipcMain.handle("desktop:display-info", () => {
  const primary = screen.getPrimaryDisplay();
  return {
    platform: os.platform(),
    primary: {
      x: primary.bounds.x,
      y: primary.bounds.y,
      width: primary.bounds.width,
      height: primary.bounds.height,
      scaleFactor: primary.scaleFactor
    }
  };
});

ipcMain.handle("desktop:device-id", () => readOrCreateDeviceId());

function ensureInputHelper() {
  if (inputHelper && !inputHelper.killed) {
    if (!lastInputHelperError.includes("Accessibility permission is required")) {
      return { ok: true, child: inputHelper };
    }

    inputHelper.kill();
    inputHelper = null;
    lastInputHelperError = "";
  }

  const bin = helperPath();
  if (!fs.existsSync(bin)) {
    return {
      ok: false,
      error: `Native input helper not built. Run: npm run build:helper`
    };
  }

  inputHelper = spawn(bin, [], { stdio: ["pipe", "ignore", "pipe"] });
  lastInputHelperError = "";

  inputHelper.stderr.on("data", (chunk) => {
    lastInputHelperError = chunk.toString().trim();
    console.error(lastInputHelperError);
  });

  inputHelper.on("close", () => {
    inputHelper = null;
  });

  return { ok: true, child: inputHelper };
}

function checkInputPermission() {
  const bin = helperPath();
  if (!fs.existsSync(bin)) {
    return Promise.resolve({
      ok: false,
      error: `Native input helper not built. Run: npm run build:helper`
    });
  }

  return new Promise((resolve) => {
    const child = spawn(bin, ["--check-accessibility"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({
        ok: code === 0,
        stdout: stdout.trim(),
        error: stderr.trim()
      });
    });
  });
}

ipcMain.handle("native-input:status", () => checkInputPermission());

ipcMain.handle("native-input:send", async (_event, inputEvent) => {
  const permission = await checkInputPermission();
  if (!permission.ok) return permission;
  lastInputHelperError = "";

  const helper = ensureInputHelper();
  if (!helper.ok) return helper;

  const display = screen.getPrimaryDisplay();
  const payload = {
    ...inputEvent,
    display: {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height
    }
  };

  return new Promise((resolve) => {
    helper.child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
      if (error) {
        resolve({ ok: false, error: error.message });
        return;
      }

      resolve({ ok: true, error: lastInputHelperError });
    });
  });
});

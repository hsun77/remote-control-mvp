import { app, BrowserWindow, desktopCapturer, ipcMain, screen, session, systemPreferences } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const projectRoot = path.resolve(__dirname, "../../..");
let macInputAddon = null;
let macInputAddonError = "";
let useSystemScreenPicker = true;

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

function macInputAddonPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "mac-input.node");
  }
  return path.join(projectRoot, "native-mac-input-addon", "build", "Release", "mac-input.node");
}

function loadMacInputAddon() {
  if (process.platform !== "darwin") return null;
  if (macInputAddon) return macInputAddon;

  const addonPath = macInputAddonPath();
  try {
    macInputAddon = require(addonPath);
    macInputAddonError = "";
    return macInputAddon;
  } catch (error) {
    macInputAddonError = `Could not load mac input addon at ${addonPath}: ${error.message}`;
    return null;
  }
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
    { useSystemPicker: useSystemScreenPicker }
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

ipcMain.handle("desktop:capture-mode", (_event, mode) => {
  useSystemScreenPicker = mode !== "direct";
  setupDisplayMedia();
  return { ok: true, mode: useSystemScreenPicker ? "picker" : "direct" };
});

ipcMain.handle("desktop:screen-permission", () => {
  if (process.platform !== "darwin") {
    return { ok: true, status: "granted" };
  }

  try {
    const status = systemPreferences.getMediaAccessStatus("screen");
    return { ok: status === "granted", status };
  } catch (error) {
    return { ok: false, status: "unknown", error: error.message };
  }
});

function checkInputPermission() {
  const addon = loadMacInputAddon();
  if (addon) {
    const trusted = addon.isTrusted();
    if (trusted.ok) {
      return Promise.resolve({ ...trusted, helperPath: macInputAddonPath(), engine: "mac-input-addon" });
    }

    return Promise.resolve({
      ...addon.requestTrust(),
      helperPath: macInputAddonPath(),
      engine: "mac-input-addon"
    });
  }
  if (process.platform === "darwin" && macInputAddonError) {
    return Promise.resolve({ ok: false, error: macInputAddonError, helperPath: macInputAddonPath(), engine: "mac-input-addon" });
  }

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
        error: stderr.trim(),
        code,
        helperPath: bin
      });
    });
  });
}

ipcMain.handle("native-input:status", () => checkInputPermission());

ipcMain.handle("native-input:send", async (_event, inputEvent) => {
  const permission = await checkInputPermission();
  if (!permission.ok) return permission;

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

  const addon = loadMacInputAddon();
  if (addon) {
    return { ...addon.sendInput(payload), helperPath: macInputAddonPath(), engine: "mac-input-addon" };
  }

  return new Promise((resolve) => {
    const bin = helperPath();
    if (!fs.existsSync(bin)) {
      resolve({
        ok: false,
        error: `Native input helper not built. Run: npm run build:helper`
      });
      return;
    }

    const child = spawn(bin, [], { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => {
      resolve({ ok: false, error: error.message });
    });

    child.on("close", (code) => {
      const error = stderr.trim();
      resolve({
        ok: code === 0 && !error,
        error,
        code,
        helperPath: bin
      });
    });

    child.stdin.end(`${JSON.stringify(payload)}\n`, (error) => {
      if (error) {
        resolve({ ok: false, error: error.message });
      }
    });
  });
});

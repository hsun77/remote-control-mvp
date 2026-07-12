import { app, BrowserWindow, desktopCapturer, ipcMain, screen } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import os from "node:os";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../../..");
let inputHelper = null;
let lastInputHelperError = "";

function helperPath() {
  const exe = process.platform === "win32" ? "native-input-helper.exe" : "native-input-helper";
  if (app.isPackaged) {
    return path.join(process.resourcesPath, exe);
  }
  return path.join(projectRoot, "native-input-helper", "target", "release", exe);
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
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

ipcMain.handle("desktop:list-sources", async () => {
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width: 320, height: 180 }
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    displayId: source.display_id,
    thumbnail: source.thumbnail.toDataURL()
  }));
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

function ensureInputHelper() {
  if (inputHelper && !inputHelper.killed) return { ok: true, child: inputHelper };

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

ipcMain.handle("native-input:send", async (_event, inputEvent) => {
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

  helper.child.stdin.write(`${JSON.stringify(payload)}\n`);
  return { ok: true, error: lastInputHelperError };
});

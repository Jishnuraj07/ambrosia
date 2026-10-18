// Rasterises desktop/icon.svg to build/icon.png (1024px) with Electron itself,
// so no image library is needed. electron-builder turns the PNG into the
// Windows .ico and macOS .icns.
//
//   npx electron scripts/make-icon.mjs
import { app, BrowserWindow } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const svg = fs.readFileSync(path.join(root, "desktop", "icon.svg"), "utf8");
const size = 1024;

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: size,
    height: size,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`;
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((r) => setTimeout(r, 300));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  fs.mkdirSync(path.join(root, "build"), { recursive: true });
  fs.writeFileSync(path.join(root, "build", "icon.png"), image.resize({ width: size, height: size }).toPNG());
  fs.writeFileSync(path.join(root, "desktop", "icon.png"), image.resize({ width: 256, height: 256 }).toPNG());
  console.log("wrote build/icon.png and desktop/icon.png");
  app.quit();
});

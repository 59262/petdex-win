import { app, BrowserWindow, screen } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";

app.commandLine.appendSwitch('enable-transparent-visuals');

app.whenReady().then(() => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const WINDOW_W = 140;
  const WINDOW_H = 180;
  const x = Math.round((width - WINDOW_W) / 2);
  const y = Math.round((height - WINDOW_H) / 2);

  const spritePath = join(homedir(), ".petdex", "pets", "nezuko", "spritesheet.webp");
  const spriteUrl = `file:///${spritePath.replace(/\\/g, "/")}`;

  console.log(`Sprite URL: ${spriteUrl}`);

  const win = new BrowserWindow({
    width: WINDOW_W,
    height: WINDOW_H,
    x,
    y,
    transparent: true,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <style>
      html, body { margin: 0; padding: 0; background: transparent; overflow: hidden; width: 100%; height: 100%; }
      .pet {
        position: fixed;
        left: 8px;
        top: 34px;
        aspect-ratio: 192 / 208;
        width: 4.5rem;
        image-rendering: pixelated;
        background-image: url('${spriteUrl}');
        background-repeat: no-repeat;
        background-size: 800% 900%;
        background-position: 0% 0%;
      }
    </style>
    <body>
      <div class="pet"></div>
    </body>
    </html>
  `)}`);

  console.log("Nezuko test window created!");
});

app.on("window-all-closed", () => {
  app.quit();
});

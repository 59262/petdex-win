import { app, BrowserWindow } from "electron";
import { homedir } from "node:os";
import { join } from "node:path";

app.whenReady().then(() => {
  const spritePath = join(homedir(), ".petdex", "pets", "nezuko", "spritesheet.webp");
  const spriteUrl = `file:///${spritePath.replace(/\\/g, "/")}`;

  const win = new BrowserWindow({
    width: 400,
    height: 400,
    transparent: false,
    frame: true,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
    },
  });

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <body style="background: #333; margin: 0; padding: 20px;">
      <h2 style="color: white;">Image Test</h2>
      <p style="color: white;">Sprite URL: ${spriteUrl}</p>
      <div style="width: 192px; height: 208px; border: 2px solid red; background-image: url('${spriteUrl}'); background-size: 800% 900%; background-position: 0% 0%; background-repeat: no-repeat; image-rendering: pixelated;"></div>
      <p style="color: white;">If you see the image above, the sprite is loading correctly.</p>
    </body>
    </html>
  `)}`);

  console.log("Image test window created!");
});

app.on("window-all-closed", () => {
  app.quit();
});

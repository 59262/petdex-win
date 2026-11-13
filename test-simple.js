import { app, BrowserWindow } from "electron";

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 500,
    height: 500,
    transparent: false,
    frame: true,
    alwaysOnTop: true,
  });

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <body style="background: orange; display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0;">
      <h1 style="color: white; font-size: 48px;">TEST WINDOW</h1>
    </body>
    </html>
  `)}`);

  console.log("Simple test window created!");
});

app.on("window-all-closed", () => {
  app.quit();
});

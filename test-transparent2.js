import { app, BrowserWindow } from "electron";

app.commandLine.appendSwitch('enable-transparent-visuals');

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 300,
    height: 300,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
  });

  win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <body style="background: transparent; margin: 0; padding: 20px;">
      <div style="background: rgba(255, 0, 0, 0.8); color: white; padding: 40px; border-radius: 10px; text-align: center; font-family: sans-serif;">
        <h1>Transparent Window</h1>
        <p>If you can see this, transparent windows work!</p>
      </div>
    </body>
    </html>
  `)}`);

  console.log("Transparent test window created!");
});

app.on("window-all-closed", () => {
  app.quit();
});

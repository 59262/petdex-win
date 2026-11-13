# 使用说明

## 准备宠物

将兼容资源放到 `%USERPROFILE%\\.petdex\\pets\\<slug>\\` 或 `assets/pets/<slug>/`。

必需文件：

- `spritesheet.webp` 或 `spritesheet.png`
- 可选 `pet.json`、`persona.md`、`run.mp3`、`jump.mp3`、`wave.mp3`、`fail.mp3`

## 配置

应用从 `%USERPROFILE%\\.petdex\\config.json` 读取配置。可以复制示例：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.petdex" | Out-Null
Copy-Item .\examples\config.example.json "$env:USERPROFILE\.petdex\config.json"
```

## CLI

```powershell
node .\bin\petdex-win.js up
node .\bin\petdex-win.js status
node .\bin\petdex-win.js state waving
node .\bin\petdex-win.js down
```

## hooks

```powershell
node .\bin\petdex-win.js hooks install
node .\bin\petdex-win.js hooks uninstall
```

## 手工检查

```powershell
node --check src/main.js
node --check src/sidecar/server.js
node --check src/hooks/install.js
node --check src/chat-preload.js
node --check src/preload.js
npm audit --omit=dev
```

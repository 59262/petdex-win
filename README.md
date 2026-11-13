# petdex-win

一个基于 Electron 的桌面宠物应用。它读取 petdex 兼容的 8×9 spritesheet，在桌面上显示动画，并通过本地 sidecar 接收开发工具或命令行程序的状态更新。项目也包含可选的聊天与语音接口。

## 功能

- 透明置顶桌面宠物、拖拽和动作切换
- 本地 sidecar 状态服务
- CLI 启动、停止、状态和动作控制
- 可选的 LLM 聊天、语音识别与语音合成
- 可选的 Claude Code hooks 集成
- 从项目资源目录和用户宠物目录发现宠物

## 项目结构

```text
src/main.js           Electron 主进程、窗口、IPC 和服务调用
src/preload.js        宠物窗口桥接层
src/chat.html         聊天窗口
src/chat-preload.js   聊天窗口桥接层
src/sidecar/server.js 本地状态 HTTP 服务
src/hooks/install.js  hooks 安装与卸载
bin/petdex-win.js     CLI 入口
assets/pets/          宠物资源目录
docs/                 使用与架构说明
examples/             配置示例
test-*.js             手工 Electron 测试脚本
```

## 环境要求

- Windows 10/11（主要支持平台）
- Node.js 18 或更高版本
- npm
- 至少一个 petdex 兼容宠物包

## 安装和运行

```powershell
npm install
npm start
```

CLI：

```powershell
npm run up
node .\bin\petdex-win.js status
node .\bin\petdex-win.js state running
node .\bin\petdex-win.js down
```

## 宠物资源

将资源放到 `%USERPROFILE%\\.petdex\\pets\\<slug>\\`，或放到 `assets/pets/<slug>/`：

```text
<slug>/
├── pet.json
└── spritesheet.webp
```

spritesheet 使用 8 列 × 9 行布局，每个单元格 192×208 像素。`pet.json` 至少包含 `displayName` 或 `id` 字段。

## 配置

应用配置文件为 `%USERPROFILE%\\.petdex\\config.json`，可参考 [examples/config.example.json](examples/config.example.json)。

## 检查

```powershell
Get-ChildItem src,bin -Recurse -File -Filter *.js | ForEach-Object { node --check $_.FullName }
npm audit --omit=dev
```

当前仓库没有统一测试套件或 lint 配置；`test-*.js` 用于手工窗口验证。

## 许可证

许可证字段见 `package.json`。正式发布前请根据项目维护者的选择补充许可证文件。

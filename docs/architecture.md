# 架构说明

```text
Electron 主进程
  ├─ 宠物窗口和聊天窗口
  ├─ preload/IPC 桥接
  ├─ LLM 与语音服务调用
  └─ 启动本地 sidecar

本地 sidecar
  ├─ 健康检查
  ├─ 状态读取与更新
  └─ 气泡消息读取与更新
```

## 主要模块

- `src/main.js`：负责 Electron 生命周期、窗口创建、宠物发现、配置、聊天和语音调用。
- `src/preload.js`：向宠物窗口暴露有限的 IPC 方法。
- `src/chat.html`：聊天窗口界面、消息显示、录音和音频播放。
- `src/chat-preload.js`：向聊天窗口暴露有限的 IPC 方法。
- `src/sidecar/server.js`：提供本地状态服务，并把状态写入运行时目录。
- `src/hooks/install.js`：向 Claude Code 设置写入或移除状态回调。
- `bin/petdex-win.js`：提供启动、停止、状态和动作命令。

## 运行流程

1. Electron 启动后扫描项目和用户宠物目录。
2. 主进程启动 sidecar，并创建透明宠物窗口。
3. CLI 或 hooks 向 sidecar 发送动作和状态。
4. 宠物窗口通过 IPC 读取状态并更新动画。
5. 聊天窗口通过 IPC 读取配置、历史消息并调用服务。

## 宠物资源布局

```text
<pet-root>/<slug>/
├── pet.json
├── spritesheet.webp
├── persona.md
└── *.mp3
```

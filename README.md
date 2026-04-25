# SUSUSingBoard

抖音直播间弹幕匹配 + 实时点歌列表的桌面小工具。自用项目。

## 干嘛用

主播在直播时，观众在弹幕里发"点歌 XXX"，工具自动识别匹配规则、把歌名提取出来显示在一份实时列表里。点歌冷却、粉丝团等级过滤、同名去重都内置。支持复制单条、复制全部、手动添加、清空。

## 技术栈

- Tauri 2（Rust 壳 + WebView 前端）
- React + Vite + TypeScript + Zustand
- SQLite via `tauri-plugin-sql`（配置 + 历史持久化）
- Node sidecar 跑 [`douyin-danma-listener`](https://www.npmjs.com/package/douyin-danma-listener) 处理抖音 WSS / 签名 / protobuf

## 跑起来

```bash
pnpm install
pnpm tauri:dev
```

## 打包

```bash
pnpm tauri:build
```

产物：
- macOS: `src-tauri/target/release/bundle/dmg/*.dmg`
- Windows: `src-tauri/target/release/bundle/{msi,nsis}/*`

跨平台只能在目标平台上跑（pkg 编 sidecar、cargo 编 Rust 都不能交叉）。

## 配置

启动后在 UI 顶部填：
- **抖音直播间 ID** — 网页直播间 URL `https://live.douyin.com/{这一串}`
- **点歌指令(正则)** — 默认 `^点歌\s+(.+)`，第一个捕获组是歌名
- **最低粉丝团等级** — 0 = 不限

点 **开始** 连接，点 **停止** 断开。每次开始会清空当前列表（DB 里的历史记录保留）。

## License

GPLv3（受 `douyin-danma-listener` 影响必须 GPL 兼容）

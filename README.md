# BB 拖消展示工作台

浏览器工作台支持 BB 棋盘和供给编辑、真人与机器 Take、参考视频观察、素材与声音变体、预览及 MP4 导出。参考视频需要人工或 Agent 观察标注，不提供任意视频的自动识别。

运行需要 Node.js 22.12 及以上和支持 WebCodecs 的桌面浏览器：

```sh
npm ci
npm run dev
```

测试使用 `npm test`、`npm run check` 和 `npm run build`。单次浏览器预览、保存与导出检查可运行 `npm run test:browser:preview-session`，需要本机 Chrome、FFmpeg 和 FFprobe。作品使用、素材支持和限制见 [BB 工作流](docs/BB_WORKFLOW.md)；模块职责见 [架构](docs/ARCHITECTURE.md)。

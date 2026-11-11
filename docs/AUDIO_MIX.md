# 独立声音与共享混音

BB、BC 和 CLI 使用同一个 `production.audio` PCM 混音器，玩法事件仍由各自帧源产生。连续预览、完整视频与片段输出不另行定义音量或人声时序。

## 实际声音角色

| 角色                     | 合同与消费者                                                          | 编辑范围                                                               |
| ------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| BGM                      | `audio.bgm`，`compileProductionAudio` / `compileProductionAudioAsync` | 素材、启用、增益、Take 开始秒、源内偏移、循环、淡入淡出                |
| 落位、消除及其他语义音效 | `audio.cues`；BB 与 BC 各自的语义事件，支持精确 eventId               | 素材、增益、事件偏移；现有 cue 合同不支持源内偏移、循环或淡入淡出      |
| 人声时间 cue             | `audio.voices`，同一混音器的新消费者                                  | 唯一 ID、Take ID、素材、启用、开始秒、增益、源内偏移、淡入淡出；不循环 |

BB 落位为 `block-placement.placement-committed`；普通消除为 `line-cleared` / `cross-cleared`，观察工程使用 `reference-clear-body` / `reference-clear-heavy`。BC 使用 `block-crush-drop.piece-committed` 与 `block-crush-drop.blocks-eliminated`。不能在 BC 中套用 BB 的事件、坐标或帧规则。其他已有事件 cue（包括某些 BB 表现中的鼓励语事件）保持原合同；事件存在于标签目录不代表每个 Take 都会触发。

过去没有独立的人声总线。把人声 WAV 绑到旧事件 cue 时，它仍属于音效总线。本轮新增 `voices` 用 Take 的秒数明确定位人声，不推断人声语义，不自动转换已有 cue。人声独立于 `sfxEnabled` 和 `sfxGain`，仍受 `masterGain` 控制。

WAV 是一个声音文件，可能是音乐，也可能已包含音乐、人声和固定音效的预混音。软件不能从其中恢复独立轨道；替换这种 WAV 会同时影响它包含的全部声音。请导入本来就分离的声音素材。

## 浏览器编辑

两个工作台的“分轨混音与人声”使用同一编辑组件。先导入 WAV，再给 BGM、事件或人声选择素材。导入本身不绑定声音。已有预设 cue 会在编辑时显式展开，保留未修改 cue、精确事件 ID 及偏移。

“核验并应用混音”检查严格合同、Take 引用、实际字节、SHA-256、WAV 解码并试算每个非空 Take。全部成功才更新候选工程。失败保留原工程和当前草稿；应用后还需另存工程。编辑器的未应用草稿接入页面离开保护；过期导入结果不能写入新工程。

支持单/双声道 PCM16 或 IEEE float32 WAV，单文件最多 16 MiB。缺失引用、未解析外部引用、错误 Base64、哈希错误、损坏 WAV、不支持的编码和越界人声源偏移会包含具体素材或 cue ID。MP3/AAC 输入没有新增解码器。

## 人声压低

压低是显式可选配置，默认关闭。示例：

```json
{
  "voices": [
    {
      "id": "narration-1",
      "takeId": "demo",
      "assetId": "speech",
      "startSeconds": 1.2,
      "gain": 0.8,
      "sourceOffsetSeconds": 0,
      "fadeInSeconds": 0.02,
      "fadeOutSeconds": 0.05
    }
  ],
  "ducking": {
    "enabled": true,
    "bgmGain": 0.35,
    "sfxGain": 0.6,
    "eventTypes": ["block-crush-drop.piece-committed"],
    "attackSeconds": 0.08,
    "releaseSeconds": 0.25
  }
}
```

示例在人声期间把 BGM 保留至原音量的 35%（约 −9.1 dB），只把列出的音效保留至 60%（约 −4.4 dB）。未列出的音效和人声自身不压低。`eventTypes` 支持与现有 cue 相同的精确类型或 `*.` 后缀模式；空数组保持全部音效原音量。

起音从人声开始前 80 ms 线性进入完整压低；人声素材有效时长内保持，结束后 250 ms 线性恢复。时长使用文件扣除源内偏移后的长度，文件内静音也属于该时长，不进行语音活动检测。禁用或增益为 0 的人声不触发压低。

重叠区不叠乘压低。相邻人声间隔不超过起音与恢复之和时合并成一段，间隙保持压低，避免音量反复起伏。不同 Take 的人声不互相影响。片段导出先在完整 Take 的时间上计算人声与包络，再取对应窗口；从人声中间开始的片段不会重新起音。完整混音和片段切片有自动等价测试。

## 保存与兼容

类型、严格解析、BB 的各层工程 Schema 与 BC Schema 均识别这些字段；预览和视频确实消费它们。旧工程没有 `voices` 或 `ducking` 时 PCM 不变；不会自动插入测试音。首次给无音频工程添加 BGM、素材或人声不会启用默认游戏音效。替换 BGM、人声或某个 cue 保留其他轨道和玩法。

新增字段是可选扩展；旧版本软件会明确拒绝未知字段。不要使用旧版本重存新工程来规避校验。CLI 删除被人声引用的 Take 会拒绝，并列出引用 cue；先显式处理人声引用。

浏览器 WebAudio 启动及 PCM 测量通过，不等于实际扬声器听感被认可。有声 MP4 还依赖当前浏览器的 AVC/AAC 编码能力；不支持时必须报错。本轮实际媒体证据与未完成的本机验收见 [开发记录](WORKBENCH_IMPROVEMENTS.md)。

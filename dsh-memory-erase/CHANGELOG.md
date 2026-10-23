# Changelog

## 1.0.1 — 2026-10-23

识别规则简化：**只看标记文件，不看盘符、卷标或序列号**。

- Host 半：
  - 扫描所有已挂载介质的根目录（Windows 盘符，macOS `/Volumes`，Linux `/media`、`/run/media`、`/mnt`），
    只要根目录存在 `.dsh-memory-erase.key` 且 `plugin` 字段匹配即识别。
  - 移除 `volumeSerial` 校验与 `vol` 调用；盘符/挂载路径只用于界面展示。
  - `/plugin/memory-erase/status` 返回识别结果与当前会话的上下文余量。
  - `/plugin/memory-erase/erase` 创建同工作区空白会话 → 归档原会话 → 记录目录移入回收区。
  - 删除路径写 `~/.dsh/logs/memory-erase-audit.jsonl` 审计。
- 浏览器半：
  - 弹出「要删除全部记忆吗？」确认窗口（当前会话名、介质位置与卷标、不可撤销警告）。
  - 选「否」显示上下文余量，不删除任何内容。
  - 选「是」播放渐白动画并显示「愿你有一天能和你最重要的人相遇」，随后切到空白会话。
  - 侧栏底部「记忆删除协议」按钮可重新唤醒弹窗。
- 工具：
  - `tools/生成U盘标记.bat`、`tools/New-MemoryEraseKey.ps1`、`tools/make-usb-key.mjs` 三种标记文件生成方式。
  - 生成器不再读取/写入卷序列号；未指定盘符时会列出当前已带标记的介质。

## 1.0.0 — 2026-10-23

首个发布版本。

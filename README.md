# 记忆删除协议 · Memory Erase Protocol

> 「愿你有一天能和你最重要的人相遇。」

一个受动画《可塑性记忆》启发的 **DeepSeek Harness Web 插件**。
当某块存储介质带着「标记文件」接入电脑时，页面会弹出确认窗口，问你：

**「要删除全部记忆吗？」**

- 选 **否**：显示当前上下文的余量，**不删除任何东西**。
- 选 **是**：进入**二次确认**——再点一次「确认删除」才会真正执行；随后屏幕渐变为白，
  浮现上面那句话；当前显示的会话被删除，界面回到一个空白会话，并且在拔下这块介质之前**不再弹窗**。

> **识别只看文件。** 不认盘符，不认卷标，不认序列号——任何已挂载的介质，只要根目录里有
> `.dsh-memory-erase.key`，就会被识别。

---

## 目录

- [它会做什么](#它会做什么)
- [安装](#安装)
- [制作标记文件](#制作标记文件)
- [使用](#使用)
- [配置](#配置)
- [文件结构](#文件结构)
- [实现要点](#实现要点)
- [常见问题](#常见问题)
- [已知限制](#已知限制)
- [许可](#许可)

---

## 它会做什么

| 场景 | 行为 |
| --- | --- |
| 没有带标记的介质 | 完全静默：不弹窗、不扫描会话、不改动任何数据 |
| 接入带标记的介质 | 弹出确认窗口：当前会话名、介质位置与卷标、不可撤销的警告 |
| 点「否，保留记忆」 | 收起窗口，在输入框上方显示当前上下文的已用 / 剩余 token 与剩余百分比 |
| 点「是，删除全部记忆」 | 进入**二次确认**：列出将被删除的内容，只有再点「确认删除」才执行 |
| 二次确认后 | 渐白 → 显示「愿你有一天能和你最重要的人相遇」→ 归档并移出当前会话 → 自动切到同工作区的空白新会话，**之后不再弹窗** |
| 拔出后再接入 | 视作新的一次接入，重新询问一次 |
| 一直插着、已点过「否」 | 侧栏底部的「记忆删除协议」按钮可让弹窗重新出现（同样不会删除任何东西；若已经删除过则会提示先拔出再接入） |

### 安全设计

- **只作用于「当前显示的会话」**，不是全部会话、不是其他会话。
- **两道确认**：第一次点「是」只进入二次确认页，必须再点「确认删除」才会执行；任何时候都可以返回。
- 删除成功后，**这块介质在拔下之前不会再询问**；即便刷新页面或新建了空白会话也不会。
- 会话记录不会立刻物理擦除：它先被移到回收区 `~/.dsh/.memory-erase-trash/`（在 `sessions/` **之外**），
  默认保留 **7 天**后自动清理；想立即彻底删除，手动清空该目录即可。
- 目录扫描**只查介质根目录**，不递归、不读取 U 盘里的其他内容；标记文件内容只用于取 `label`。
- 界面配色为蓝色系；只有「不可撤销」的警示行沿用主题的警示色。

---

## 安装

插件是一个标准的 DSH bundle：仓库根的 `package.json` 声明了 `dsh.bundle.patch` 与 `dsh.client`。
安装后会自动插入 `memory-erase` 这一行并启用。以下三种方式等价，任选其一。

### 方式 A：在 DeepSeek 对话框里直接说

把 `YOUR_GITHUB_NAME` 换成你的 GitHub 用户名，然后对 DeepSeek 说：

```text
用 plugin_manager 的 install_bundle 安装这个插件：
https://github.com/YOUR_GITHUB_NAME/dsh-memory-erase
```

或等价写法：

```text
安装插件 github:YOUR_GITHUB_NAME/dsh-memory-erase
```

### 方式 B：DSH Web 界面

1. 打开 DSH Web，左侧进入 **Plugins / 插件**。
2. 点 **Add / 添加**。
3. 「包名或地址」填仓库地址：
   `https://github.com/YOUR_GITHUB_NAME/dsh-memory-erase`
4. 安装完成后刷新一次页面。

### 方式 C：命令行

```powershell
dsh plugin --profile web add https://github.com/YOUR_GITHUB_NAME/dsh-memory-erase
```

### 安装说明

- 需要本机能访问 GitHub；国内网络可用安装界面里的「改用国内镜像」，或先配置代理。
- 本插件是纯 JavaScript，**无构建步骤、无安装脚本**，不需要批准任何 build script。
- 安装或更新后，**刷新一次 DSH Web 页面**，浏览器端才会加载新的 `client.js`。

---

## 制作标记文件

插件只认一个文件：介质根目录下的 **`.dsh-memory-erase.key`**。
它不关心介质是 U 盘、移动硬盘还是本地磁盘，也不关心盘符或卷标——把同一个文件放进任意介质的根目录即可。
仓库自带三种生成方式，标记文件不会改动介质里的其他内容。

### Windows：双击 bat

```
tools\生成U盘标记.bat
```

双击后脚本会列出**当前已能被插件识别的介质**，并提示如何写入。
如果要指定盘符代写，用 PowerShell：

```powershell
# 写入 E:
powershell -ExecutionPolicy Bypass -File tools\New-MemoryEraseKey.ps1 -Drive E:

# 覆盖已有标记
powershell -ExecutionPolicy Bypass -File tools\New-MemoryEraseKey.ps1 -Drive E: -Force

# 只预览内容，不写文件
powershell -ExecutionPolicy Bypass -File tools\New-MemoryEraseKey.ps1 -Drive E: -WhatIfMarker
```

不带 `-Drive` 时只扫描并列出已带标记的介质，不写任何文件。

### 跨平台：Node

```bash
node tools/make-usb-key.mjs --list                    # 列出已经带标记的介质
node tools/make-usb-key.mjs --drive E:                # Windows 盘符
node tools/make-usb-key.mjs --drive /Volumes/MY_USB   # macOS / Linux 挂载点
node tools/make-usb-key.mjs --dry-run --drive E:      # 只预览内容
```

### 手动

在目标介质根目录新建 `.dsh-memory-erase.key`（UTF-8，**不要 BOM**），内容：

```json
{
  "plugin": "memory-erase",
  "id": "plastic-memories",
  "label": "MEMORY ERASE MEDIUM"
}
```

- `plugin` 必须是 `memory-erase`，否则插件不认。
- 其余字段都只是展示用；旧版本留下的 `volumeSerial`、`drive` 会被忽略。
- **换介质**：把同一个文件复制到新介质根目录即可。
- **临时停用某块介质**：删掉它根目录下的 `.dsh-memory-erase.key`。

---

## 使用

1. 接入已写入标记文件的介质。
2. 打开或刷新 DSH Web。
3. 出现「要删除全部记忆吗？」：
   - **否，保留记忆** → 显示上下文余量，什么都不删。
   - **是，删除全部记忆** → 进入二次确认页；确认无误后点 **确认删除，不再保留**。
     随后渐白、显示那句话、约 6 秒后回到一个空白会话。
4. 删除完成后，这块介质在拔下之前不会再弹窗；刷新页面也一样。
   想再触发，拔出等待识别消失后重新接入。

### 操作之后

- 原会话从侧栏消失（已归档），同一工作区里自动出现一个空白会话并切换过去。
- 原会话记录被移到 `~/.dsh/.memory-erase-trash/<会话 ID>.<时间戳>/`（在 `sessions/` **之外**），保留 7 天。
- 如果记录文件当时被占用、没能移动，界面仍会切到空白会话，并提示记录留在原处。

---

## 配置

默认值随仓库提供；要覆盖，在 profile 的 `cordis.patch.yml` 里写同 id 的行：

```yaml
- id: memory-erase
  name: '@local/dsh-memory-erase'
  config:
    markerFile: .dsh-memory-erase.key   # 标记文件名
    pollIntervalMs: 1200                # 扫描介质的间隔（毫秒）
    trashRetentionDays: 7               # 回收区保留天数；0 = 立即清理
    testMode: false                     # 是否开启本地自测接口
```

### 本地自测接口（`testMode: true` 时可用）

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `GET` | `/plugin/memory-erase/status` | 当前识别到的介质、当前会话的上下文余量 |
| `POST` | `/plugin/memory-erase/ack` | 标记本轮已确认（收起弹窗） |
| `POST` | `/plugin/memory-erase/rearm` | 重新唤醒弹窗（侧栏按钮用的就是它） |
| `POST` | `/plugin/memory-erase/erase` | 执行删除；body `{"sessionId":"..."}`，加 `"preview":true` 只预演不删除 |
| `GET` | `/plugin/memory-erase/debug` | 介质、Host 活跃会话、轮询统计 |
| `POST` | `/plugin/memory-erase/test-trigger` | 不接介质也模拟一次「接入」 |

> `testMode` 只影响这些进程内自测接口，不影响真实识别与弹窗逻辑。

---

## 文件结构

```
.
├─ package.json            # 插件清单：dsh.bundle.patch + dsh.client + exports
├─ cordis.patch.yml        # 插入 memory-erase 这一行并给默认配置
├─ index.js                # Host 半：识别介质、取上下文、归档/清除/新建会话
├─ client.js               # 浏览器半：弹窗、二次确认、渐白、上下文余量、侧栏入口
├─ locale/
│  ├─ zh.json              # 插件列表里的中文标题与描述
│  └─ en.json              # 英文标题与描述
├─ icon.svg                # 插件图标
├─ tools/
│  ├─ 生成U盘标记.bat       # 双击运行
│  ├─ New-MemoryEraseKey.ps1
│  └─ make-usb-key.mjs
├─ README.md
├─ CHANGELOG.md
└─ LICENSE
```

---

## 实现要点

- **浏览器 ↔ Host**：同源的插件私有 HTTP 路由 `/plugin/memory-erase/*`；
  不经过会话 API，不读写其他插件的数据。
- **识别**：Host 每隔 `pollIntervalMs` 扫描各已挂载介质的根目录
  （Windows 盘符；macOS `/Volumes`；Linux `/media`、`/run/media`、`/mnt`），
  发现 `.dsh-memory-erase.key` 且 `plugin` 字段匹配即视为识别成功。
  **盘符、卷标、序列号都不参与判断**，只用于界面展示。
- **上下文余量**：Host 用 `tokenMeter.measure(session)` 与会话记录的 `contextWindow`
  计算已用 / 剩余，浏览器只负责显示。
- **删除**：先在同工作区创建空白新会话 → 归档旧会话（`stopActivity`）→
  把旧会话记录目录移入回收区 → 浏览器切到新会话；同时记住这块介质已经删除过，
  在它被拔出之前不再弹窗。
- **二次确认**：第一次「是」只切换确认页；真正的 `POST /erase` 只由第二颗按钮发出。
- **审计**：只为删除路径写 `~/.dsh/logs/memory-erase-audit.jsonl`
  （目标会话、记录目录、执行结果），方便事后核对。

---

## 常见问题

**Q：插上 U 盘没有弹窗？**
确认标记文件在**根目录**且文件名完全一致（`.dsh-memory-erase.key`，前面有一个点）。
文件里的 `plugin` 必须是 `memory-erase`。改完后刷新一次 DSH Web。

**Q：会不会误删别的会话？**
不会。删除目标只有「当前显示的会话」；而且要经过两道确认：第一次点「是」只是进入二次确认页，必须再点一次「确认删除」才执行。

**Q：删除之后为什么不再弹窗了？**
这是有意设计的。删除成功后，这块介质在**拔下之前**不会再询问，刷新页面或新建空白会话也一样。
想再次触发，把介质拔出、等界面识别为已移除，再重新接入即可。

**Q：能恢复吗？**
7 天内可以从 `~/.dsh/.memory-erase-trash/` 找回；之后会被自动清理。

**Q：换一块 U 盘要重新安装插件吗？**
不用。把标记文件复制到新 U 盘根目录即可；旧 U 盘删掉该文件就不再触发。

**Q：本地磁盘也能用吗？**
可以。识别只看「已挂载介质的根目录有没有这个文件」，不限可移动盘。
如果不想让某个盘触发，别在那里放标记文件。

**Q：为什么弹窗里显示盘符？**
只是告诉你「是哪块介质触发的」。盘符变化、卷标变化都不影响识别。

---

## 已知限制

- 仅支持 DSH Web（`dsh.client.platform: web`）。
- 只扫描已挂载介质的**根目录**，不递归子目录。
- 「删除」是归档 + 移入回收区（7 天），不是不可恢复的物理擦除。
- 当前会话必须已在 Host 中激活（在这个会话里发过消息），否则会提示先发一条消息再试。

## 许可

MIT，见 [LICENSE](LICENSE)。

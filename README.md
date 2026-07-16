<div align="center">

# 📱 PocketTTY

**手机端深度优化、为 herdr / tmux 量身适配的网页终端**

打开浏览器,你的终端(和里面的 AI 编码代理)就在口袋里。

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](package.json)
[![xterm.js](https://img.shields.io/badge/xterm.js-6-blue)](https://github.com/xtermjs/xterm.js)
[![Mobile First](https://img.shields.io/badge/mobile-first-ff69b4)](#-手机手势)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](#-贡献)
[![Fork of wetty](https://img.shields.io/badge/fork%20of-butlerx%2Fwetty-lightgrey)](https://github.com/butlerx/wetty)

_A mobile-first web terminal, purpose-tuned for
[herdr](https://github.com/ogulcancelik/herdr) / tmux — touch gestures, mobile
IME, real clipboard (OSC 52), keyboard avoidance. Fork of
[butlerx/wetty](https://github.com/butlerx/wetty)._

</div>

---

## ✨ 为什么是 PocketTTY

原版 wetty 在手机浏览器里几乎不可用:不能滚动、打不了字、复制不了;对 tmux /
herdr 这类接管鼠标的终端复用器也没有专门适配。PocketTTY 把这两块彻底补齐:

- 📱 **全套触摸手势**
  — 惯性滚动(甩得快滑得远)、单击=点击、双击=键盘、长按选词复制、双指长按=右键
- ⌨️ **输入法真正能用** —
  iOS/Android 中文输入、语音听写不中断、软键盘弹出时终端自动避让
- 📋 **剪贴板全通** — 划词自动复制、`⌘C`/`Ctrl+Shift+C`、OSC
  52(herdr/tmux 内部框选复制直达系统剪贴板),纯 HTTP 部署也能用
- 🖱️ **复用器友好**
  — 滚轮/触控板速度按终端惯例校准、右键透传给程序、鼠标模式下滚动语义正确(滚它的回滚区而不是页面)
- 🌐 **LAN HTTP 开箱即用** — 修复上游 CSP 导致的局域网白屏,免 TLS 即可完整使用
- 🚀 **打开即达** — `--command`
  让页面加载直接进入 herdr/tmux;支持终端内联图片(iTerm2 / SIXEL 协议)

所有改动均在真实设备验证:macOS / Windows Chrome、iOS Safari / Chrome、Android
Chrome。

## 📸 截图

|                           桌面(herdr 会话)                            |                            手机(390×844)                            |
| :-------------------------------------------------------------------: | :-----------------------------------------------------------------: |
| <img src="./docs/screenshot-desktop.png" alt="desktop" width="640" /> | <img src="./docs/screenshot-mobile.png" alt="mobile" width="220" /> |

## 🚀 快速开始

```sh
git clone https://github.com/cokekitten/PocketTTY && cd PocketTTY
pnpm install
pnpm build
```

启动(免密自动登录 + 直接进入 herdr/tmux 的示例):

```sh
node build/main.js --host 0.0.0.0 --port 3918 --title PocketTTY \
  --ssh-user <user> --ssh-key ~/.ssh/id_rsa --ssh-auth publickey \
  --command '~/.local/bin/herdr'   # 可选:页面一打开直接进入复用器
```

要点:

- `--ssh-key` 免密登录要求对应公钥在目标机的 `~/.ssh/authorized_keys`
  里。**注意:配好后局域网内任何设备打开页面即获得 shell,请自行评估网络环境。**
- `--command` 跑在非登录 shell 里,不加载 `.zshrc`,命令要写完整路径。
- 改动 `src/` 后需要重新 `pnpm build`;浏览器长开的标签页会一直用旧 JS,记得强刷。
- 想免除 macOS Chrome 的剪贴板"下一次点击"兜底,用 `--ssl-key/--ssl-cert`
  上 HTTPS 让页面成为安全上下文。

其余用法(Docker、更多参数、开发流程)见上游文档:[README.upstream.md](./README.upstream.md)。

## 📱 手机手势

| 手势          | 行为                                                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 滑动          | 按场景智能滚动:鼠标模式程序(tmux/herdr)收到滚轮报告滚自己的回滚区;vim/less 等交替屏程序收到方向键;普通 shell 滚动 xterm 回滚缓冲区。带惯性:甩得快滑得远,指数衰减,再次触摸即停 |
| 单击          | 纯点击(透传给鼠标模式程序),**永远不弹软键盘**                                                                                                                                 |
| 双击 / ⌨ 图标 | 唤出软键盘                                                                                                                                                                    |
| 单指长按      | 选中手指下的单词,拖动扩选,松手自动复制进系统剪贴板(弹"已复制"提示)                                                                                                            |
| 双指长按      | 向程序发送**右键**(两指中点位置)——herdr 的右键菜单等交互手机上也能用                                                                                                          |

软键盘弹出时终端自动收缩到可见区域,提示符始终保持在键盘上方。

## ⌨️ 桌面操作

| 操作         | 方式                                                                                      |
| ------------ | ----------------------------------------------------------------------------------------- |
| 复制         | 划词自动复制;或 `Ctrl+Shift+C`;macOS 有选区时 `⌘C`                                        |
| 鼠标模式选区 | herdr/tmux 里按住 **⌥ Option**(macOS)/ **Shift**(Windows/Linux)再拖选                     |
| 粘贴         | `Ctrl+Shift+V` / `⌘V`(浏览器右键菜单已在终端区域屏蔽,右键作为 button-2 报告直达程序)      |
| 滚动         | 滚轮约 3 行/格;触控板接近 1:1 跟手;普通 shell 的灵敏度可在 ⚙ 配置里调 `scrollSensitivity` |

## ⚙️ 配置

页面右上角 ⚙ 打开配置面板:字体、`WebGL Renderer`
开关(个别机器高负载下字形错乱时关掉它)、`Fit Terminal`、滚动灵敏度等。改动即存 localStorage,部分项刷新后生效。

## 🐛 调试

访问时在 URL 后加 `#debug`(如
`http://host:3918/#debug`)会显示悬浮日志层,实时追踪触摸、聚焦、视口(键盘弹出/收起)与剪贴板事件——在没有 devtools 的手机上排查问题全靠它。

## 🔍 技术细节:与上游的完整差异

<details>
<summary>点击展开(每一条都对应真实踩坑)</summary>

### 🌐 局域网 HTTP 部署

- **修复非 localhost 的 HTTP 访问白屏**:上游 helmet 默认 CSP 带
  `upgrade-insecure-requests`,浏览器会把所有资源请求强制升级为 HTTPS,导致 LAN
  IP 直连时样式丢失、终端加载失败。已移除该指令(HTTPS 部署不受影响)。
- **修复 macOS 上 node-pty 无法开终端**:包管理器解包 `node-pty`
  的 prebuilt 时会丢失 `spawn-helper` 的执行位,postinstall 钩子自动修复。

### 📋 剪贴板

- **划词自动复制**:HTTP 部署下没有
  `navigator.clipboard`(非安全上下文),自动降级到 `execCommand` 路径。
- **OSC 52**:tmux / herdr 内部框选复制(通过 OSC
  52 转义序列)真正落到系统剪贴板;只写不读,终端内程序无法偷读剪贴板。
- **macOS Chrome 兜底**:macOS
  Chrome 会静默丢弃"无手势上下文"的剪贴板写入(却报告成功)。异步到达的 OSC
  52 内容会同时挂起,在下一次点击/按键时于真实手势中重写,确保落盘。
- **macOS 选区修饰键**:默认开启
  `macOptionClickForcesSelection`——鼠标被程序接管时,⌥ 拖选是 macOS 上唯一的本地选区方式。

### 🖱️ 桌面滚动与右键

- **触控板不再龟速**:xterm 对小像素增量有 0.3 倍的"触控板平滑"衰减,叠加"每报告 1 行"的程序(herdr)后双指滚动近乎不动。已在鼠标模式/交替屏场景绕开衰减;普通 shell 回滚仍走 xterm 原生平滑滚动。
- **屏蔽浏览器右键菜单**:右键作为 button-2 鼠标报告直达程序。

### 📱 移动端

- **键盘避让**:基于 `visualViewport` 收缩终端,提示符保持在键盘上方——感谢
  [@snipersteve](https://github.com/snipersteve) 的贡献(#1)。
- **iOS/Android 输入法(镜像同步)**:软键盘(尤其语音听写)不是只追加的——它会范围修改已上屏的字。移动端以隐藏输入框内容为唯一真相,每次变化与影子副本做 diff,翻译成"退格×N+重打尾部"发给终端;追加、删除、语音修正统一处理。xterm 的三条内置输入路径(input 事件、229
  diff、组合助手)在移动端被捕获阶段拦截,杜绝双发。会话期间绝不程序性改动输入框(否则 IME 连接重置、语音中断),仅在失焦和回车后清空。
- **键盘召唤机制**:隐藏输入框平时处于 `readonly + inputmode=none + 未聚焦` 且
  `focus()`
  方法被接管的休眠态,任何浏览器合成事件都无法误弹键盘;双击/⌨ 通过"全新聚焦"召唤;键盘收起自动回到休眠态。

### 🖥️ 渲染

- **WebGL 上下文丢失自动降级**到 DOM 渲染器,不再留下死画布;⚙ 里可永久关闭 WebGL(个别 GPU 上高负载会出现字形图集错乱——数据无损,纯渲染问题)。

</details>

## 🤝 贡献

欢迎 Issue 和 PR。感谢 [@snipersteve](https://github.com/snipersteve)
贡献移动端键盘避让([#1](https://github.com/cokekitten/PocketTTY/pull/1))。

## 🙏 致谢

- [butlerx/wetty](https://github.com/butlerx/wetty)
  — 本项目的上游,一个优秀的网页终端
- [xterm.js](https://github.com/xtermjs/xterm.js) — 浏览器里的终端模拟器
- [herdr](https://github.com/ogulcancelik/herdr)
  — 让这一切有意义的 AI 代理终端工作区

## 📄 License

MIT,与上游一致。

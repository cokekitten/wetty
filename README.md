# WeTTY — LAN & Mobile Fork

> Fork of [butlerx/wetty](https://github.com/butlerx/wetty): a browser terminal
> tuned for plain-HTTP LAN deployments, phones/tablets, and terminal
> multiplexers like tmux / herdr. Original docs:
> [README.upstream.md](./README.upstream.md).

基于 [butlerx/wetty](https://github.com/butlerx/wetty)
的分支,目标是让"局域网 HTTP 直连 + 手机/平板 + 终端复用器(tmux/herdr)"这套组合真正可用。所有改动都在真实设备(macOS/Windows
Chrome、iOS Safari/Chrome、Android Chrome)上验证过。

## 相对上游的改动

### 🌐 局域网 HTTP 部署

- **修复非 localhost 的 HTTP 访问白屏**:上游 helmet 默认 CSP 带
  `upgrade-insecure-requests`,浏览器会把所有资源请求强制升级为 HTTPS,导致 LAN
  IP 直连时样式丢失、终端加载失败。已移除该指令(HTTPS 部署不受影响)。
- **修复 macOS 上 node-pty 无法开终端**:包管理器解包 `node-pty`
  的 prebuilt 时会丢失 `spawn-helper` 的执行位,postinstall 钩子自动修复。

### 📋 剪贴板(全平台)

- **划词自动复制**:选中即进系统剪贴板。HTTP 部署下没有
  `navigator.clipboard`(非安全上下文),自动降级到 `execCommand` 路径。
- **OSC 52 支持**:tmux / herdr 等程序内部框选复制(它们通过 OSC
  52 转义序列写剪贴板)现在真正落到系统剪贴板,只写不读(终端内程序无法偷读你的剪贴板)。
- **快捷键**:`Ctrl+Shift+C` 复制;macOS 上有选区时 `⌘C`
  复制、无选区时保持浏览器默认行为;粘贴用 `Ctrl+Shift+V` / `⌘V` / 右键粘贴。
- **macOS Chrome 兜底**:macOS
  Chrome 会静默丢弃"无手势上下文"的剪贴板写入(却报告成功)。异步到达的 OSC
  52 内容会同时挂起,在你下一次点击/按键时于真实手势中重写一遍,确保落盘。
- **macOS 选区修饰键**:默认开启
  `macOptionClickForcesSelection`——在 tmux/herdr 这类接管鼠标的程序里,**⌥
  Option+拖选**强制本地选区(其他平台是 Shift+拖选)。

### 📱 移动端(xterm.js 本身没有触摸支持)

| 手势          | 行为                                                                                                                               |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 滑动          | 按场景智能滚动:鼠标模式程序(tmux/herdr)收到滚轮报告滚自己的回滚区;vim/less 等交替屏程序收到方向键;普通 shell 滚动 xterm 回滚缓冲区 |
| 单击          | 纯点击(透传给鼠标模式程序),**永远不弹软键盘**                                                                                      |
| 双击 / ⌨ 图标 | 唤出软键盘                                                                                                                         |

- **iOS/Android 输入法修复**:iOS 软键盘的字符键只发 keyCode 229,xterm 6 的
  `_inputEvent` 启发式会把随后的 `insertText`
  输入事件全部丢弃——精确补上这条路径(不影响桌面按键、死键与中文组合输入,不会双发)。
- **键盘召唤机制**:隐藏输入框平时处于 `readonly + inputmode=none + 未聚焦` 且
  `focus()`
  方法被接管的休眠态,任何浏览器合成事件都无法误弹键盘;双击/⌨ 通过"全新聚焦"召唤(移动浏览器唯一可靠承诺弹键盘的路径);键盘收起自动回到休眠态。

### 🔧 调试

访问时在 URL 后加 `#debug`(如
`http://host:3918/#debug`)会显示一个悬浮日志层,实时追踪触摸、聚焦、视口(键盘弹出/收起)与剪贴板事件——在没有 devtools 的手机上排查问题全靠它。

## 快速开始

```sh
git clone https://github.com/cokekitten/wetty && cd wetty
pnpm install
pnpm build
```

启动(免密自动登录 + 直接进入 herdr/tmux 的示例):

```sh
node build/main.js --host 0.0.0.0 --port 3918 \
  --ssh-user <user> --ssh-key ~/.ssh/id_rsa --ssh-auth publickey \
  --command '~/.local/bin/herdr'   # 可选:页面一打开直接进入复用器
```

要点:

- `--ssh-key` 免密登录要求对应公钥在目标机的 `~/.ssh/authorized_keys`
  里。**注意:配好后局域网内任何设备打开页面即获得 shell,请自行评估网络环境。**
- `--command` 跑在非登录 shell 里,不加载 `.zshrc`,命令要写完整路径。
- 改动 `src/` 后需要重新 `pnpm build`;浏览器长开的标签页会一直用旧 JS,记得强刷。
- 想要更完整的剪贴板体验(免除 macOS Chrome 的"下一次点击"兜底),用
  `--ssl-key/--ssl-cert` 上 HTTPS 让页面成为安全上下文。

其余用法(Docker、更多参数、开发流程)见上游文档:[README.upstream.md](./README.upstream.md)。

## License

MIT,与上游一致。

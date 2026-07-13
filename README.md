# Remote Control MVP

一个 macOS / Windows 双端桌面远控 MVP。同一个 Electron 应用可以作为被控端共享桌面，也可以作为控制端连接另一台电脑。

## 功能

- WebRTC 加密桌面流传输
- 通过信令备用通道和 WebRTC DataChannel 发送鼠标键盘事件
- 6 位房间码配对
- 每台电脑首次启动会生成固定设备 ID
- 同一应用支持 host / viewer 两种模式
- Rust 原生输入 helper，目标支持 macOS / Windows 输入注入
- 支持 Mac / Windows 之间的 `Cmd` / `Ctrl` 快捷键自动映射
- 信令服务支持开发用 `ws://`，也支持证书驱动的 `wss://`
- 支持配置 TURN 中继，用于全球任意两地的公网远控

## 运行

```bash
npm install
npm run build:helper
npm run dev:server
```

另开一个终端：

```bash
npm run dev:desktop
```

两台电脑使用时：

1. 在一台机器上启动 server，并保证另一台机器能访问。
2. 两台机器都启动 desktop。
3. 被控端输入信令地址，比如 `ws://192.168.1.10:4141`，点击 `Share this computer`。
4. 控制端输入同一个信令地址和被控端显示的房间码，点击 `Connect`。

## 全球公网使用

任意两个地方的电脑不在同一个局域网时，需要一台双方都能访问的公网服务器。推荐使用任意云厂商的 1 核 1G Linux VPS，带公网 IPv4 或域名。

服务器需要开放这些端口：

- `4141/tcp`：信令服务
- `3478/tcp` 和 `3478/udp`：TURN
- `49160-49200/udp`：TURN 媒体中继端口

在公网服务器上部署：

```bash
git clone https://github.com/hsun77/remote-control-mvp.git
cd remote-control-mvp
cp .env.example .env
```

编辑 `.env`：

```text
PUBLIC_IP=你的公网服务器IP
TURN_USER=remote
TURN_PASSWORD=换成一个长随机密码
```

启动：

```bash
docker compose up -d --build
```

世界任意两地的两台电脑都填写同一组配置：

```text
Signaling URL: ws://你的公网服务器IP:4141
TURN URL: turn:你的公网服务器IP:3478
User: remote
Password: 你在 .env 里设置的 TURN_PASSWORD
```

然后被控电脑点 `Share this computer`，控制电脑输入 6 位房间码点 `Connect`。界面上的设备 ID 是固定的，用于识别这台电脑；房间码仍然是每次连接生成的临时验证码。

## 加密说明

桌面画面和输入事件走 WebRTC。WebRTC 媒体流使用 DTLS-SRTP 加密，DataChannel 使用 DTLS/SCTP 加密。

公网部署时请给信令服务也配置 TLS：

```bash
TLS_KEY_FILE=/path/to/key.pem TLS_CERT_FILE=/path/to/cert.pem npm run dev:server
```

客户端信令地址使用 `wss://your-domain:4141`。

## macOS 权限

macOS 被控端需要系统授权：

- 屏幕录制：允许 Electron 采集桌面
- 辅助功能：允许 `Remote Control MVP` 注入鼠标键盘。新版 macOS 端优先使用内置 `mac-input.node` 插件，不再依赖常驻 `native-input-helper` 进程。

## 快捷键映射

桌面端默认开启 `Translate Cmd/Ctrl shortcuts between Mac and Windows`。

- Mac 控制 Windows：`Cmd+C` / `Cmd+V` / `Cmd+A` 等会映射成 Windows 的 `Ctrl+C` / `Ctrl+V` / `Ctrl+A`
- Windows 控制 Mac：`Ctrl+C` / `Ctrl+V` / `Ctrl+A` 等会映射成 Mac 的 `Cmd+C` / `Cmd+V` / `Cmd+A`

如果想按物理按键原样发送，可以在左侧 Keyboard 区域关闭这个开关。

## macOS 官方屏幕共享备用方案

如果你主要想从 Windows 控制整台 Mac，最稳的是使用 Apple 官方 Screen Sharing/VNC，并通过 Tailscale 访问：

```bash
./scripts/enable-mac-screen-sharing.sh
```

脚本会要求输入一个 VNC 密码和 Mac 管理员密码。完成后，在 Windows 上用 VNC Viewer 连接：

```text
100.x.x.x:5900
```

其中 `100.x.x.x` 是被控 Mac 的 Tailscale IP，可用 `tailscale ip -4` 查看。

## 当前限制

- 第一版默认按主显示器坐标注入输入。
- 键盘映射覆盖常见按键和单字符输入，高级组合键后续补齐。
- TURN 当前使用静态用户名和密码，适合自用 MVP；多人产品应改成短期凭证。

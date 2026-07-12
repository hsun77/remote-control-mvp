# Remote Control MVP

一个 macOS / Windows 双端桌面远控 MVP。同一个 Electron 应用可以作为被控端共享桌面，也可以作为控制端连接另一台电脑。

## 功能

- WebRTC 加密桌面流传输
- WebRTC DataChannel 发送鼠标和键盘事件
- 6 位房间码配对
- 同一应用支持 host / viewer 两种模式
- Rust 原生输入 helper，目标支持 macOS / Windows 输入注入
- 信令服务支持开发用 `ws://`，也支持证书驱动的 `wss://`

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
- 辅助功能：允许 `native-input-helper` 注入鼠标键盘

## 当前限制

- 第一版默认按主显示器坐标注入输入。
- 键盘映射覆盖常见按键和单字符输入，高级组合键后续补齐。
- NAT 很复杂的网络可能需要 TURN 服务器，当前版本先适合局域网或可直连环境。

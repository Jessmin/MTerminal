# MTerminal

一个专注于终端、SSH 和文件管理的桌面工作台，使用 Electron、React、TypeScript、xterm.js、node-pty 和 ssh2 构建。

当前版本：**0.1.4 预览版**。提供 Apple Silicon macOS 和 Windows x64 构建。

## 功能

- 多标签本地终端，SSH 密码 / 私钥登录，主机分组和搜索。
- SSH 主机指纹确认和变更提示；可选使用系统加密保存凭据。
- 文件面板跟随当前激活的终端，支持本地文件和 SFTP。
- 文件列表自动刷新，支持路径跳转、过滤、多选、新建、重命名、删除。
- 文本编辑、修改冲突检测、原子保存；上传 / 下载进度和取消。
- 当前主机的 CPU 趋势、内存、磁盘、网卡流量、负载和运行时间；支持暂停、收起及窗口隐藏后暂停采集。

## 平台支持

| 能力 | macOS | Windows |
| --- | --- | --- |
| 本地终端 | 登录 Shell | Windows PowerShell，缺失时回退 cmd |
| SSH / SFTP、文件编辑和传输 | 支持 | 支持 |
| 当前终端文件上下文切换 | 支持 | 支持 |
| 本地 Shell 工作目录自动跟随 | 支持 | 尚未实现完整支持 |
| Linux / macOS SSH 工作目录跟随 | 支持 | 支持 |
| Linux / macOS SSH 资源监控 | 支持 | 支持 |
| 本机资源监控 | 支持 | 暂不支持 |

macOS 构建已完成本地运行验证。Windows 包在 macOS 上交叉构建，已检查 PE 架构、原生模块、应用资源及源码一致性，**尚未完成 Windows 实机运行验证**。预览版尚无 Windows 代码签名证书，macOS 使用本地临时签名。

文件夹传输请先打包。当前不包含 RDP、云同步、跳板机、断点续传或复杂交互认证。文本编辑单文件上限为 1 MiB。

## 开发

需要 Node.js 22.12+、npm；原生模块安装可能需要平台开发工具（macOS Command Line Tools，Windows 的 Python 和 Visual Studio C++ Build Tools）。首次安装会下载 Electron。

```sh
git clone https://github.com/Jessmin/MTerminal.git
cd MTerminal
npm ci
npm run dev
```

```sh
npm test                  # Node 单元测试
npm run test:ui           # React 文件面板和资源监控测试
npm run build            # 类型检查、生产构建、第三方许可声明
npm run test:integration  # macOS：原生 PTY、本机 SSH / SFTP
npm run test:smoke        # Electron 窗口渲染检查
```

集成测试使用本机回环地址和临时凭据，不访问已保存的服务器；SFTP 测试依赖 macOS 的 `/usr/libexec/sftp-server`。

## 打包

```sh
npm run dist             # macOS：生成 Apple Silicon DMG
npm run dist:win         # 生成 Windows x64 安装 EXE 和 ZIP，并校验产物
node scripts/build-windows.mjs --arm64  # 可选 Windows ARM64 构建入口，尚未验证
```

输出位于 `release/`：

- `MTerminal-0.1.4-arm64.dmg`
- `MTerminal-0.1.4-windows-x64-setup.exe`
- `MTerminal-0.1.4-windows-x64.zip`（完整解压后运行 `MTerminal.exe`）

Windows 构建使用官方 Electron 分发包，按依赖记录的 SHA-256 校验，并保留对应架构的 node-pty 预编译模块。独立校验命令：`node scripts/verify-windows.mjs`。安装包和本地构建缓存不存入 Git。

## 快捷键

macOS：⌘T 新终端，⌘N 添加主机，⌘W 关闭会话，⌘J 切换文件面板，⌘1–9 切换标签，⌘K 清屏，编辑器内 ⌘S 保存。

Windows：Ctrl+Shift+T/N/W/J 和 Ctrl+Shift+1–9 对应工作台操作，Ctrl+Shift+C/V 复制粘贴，Ctrl+Shift+K 清屏，编辑器内 Ctrl+S 保存。终端的 Ctrl+C 等控制键会传给 Shell。

## 源码与第三方许可

项目尚未授予开源许可证；公开源码不代表授予再分发许可。第三方组件的许可声明见 [THIRD_PARTY_NOTICES.txt](assets/THIRD_PARTY_NOTICES.txt)。

仓库仅包含项目源码、测试和构建脚本。本地连接配置、凭据、日志、安装包、私人诊断记录及第三方应用分析资料均不纳入版本管理。

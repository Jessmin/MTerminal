Windows x64 预览版，支持本地终端、SSH、SFTP 文件管理和远程主机资源监控。

### 下载

- `windows-x64-setup.exe`：安装版。
- `windows-x64.zip`：便携版，完整解压后运行 `MTerminal.exe`。
- `windows-x64-SHA256SUMS.txt`：安装包和 ZIP 的 SHA-256 校验值。

### 当前功能

- Windows PowerShell 本地终端，缺失时回退到 cmd；SSH 密码和私钥登录。
- 文件面板跟随当前激活终端，支持 SFTP、文件编辑、上传下载和自动刷新。
- Linux / macOS SSH 终端的工作目录自动跟随与 CPU、内存、磁盘、网卡资源监控。

### 验证范围与限制

本发布由 GitHub Actions 在 Windows runner 上构建，并通过 Node 单元测试、React 界面测试、PE 架构、原生模块及打包源码一致性检查。这些检查不等同于 Windows 桌面的完整交互验收。

当前尚未支持 Windows 本机资源采集和完整的本地 Shell 目录跟随。安装包未使用 Windows 代码签名证书。

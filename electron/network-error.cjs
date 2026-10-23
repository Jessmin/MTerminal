function connectionError(error, host, platform = process.platform) {
  if (!['EHOSTUNREACH', 'ENETUNREACH'].includes(error.code)) return error.message || 'SSH 连接失败';
  const advice = platform === 'darwin'
    ? '请检查主机地址和 VPN / 虚拟局域网连接，并在「系统设置 → 隐私与安全性 → 本地网络」中允许 MTerminal，然后重新连接。'
    : '请检查主机地址、网络路由和 VPN / 虚拟局域网连接，然后重新连接。';
  return `无法到达 ${host.hostname}:${host.port}（${error.code}），尚未进入 SSH 登录阶段。${advice}\n原始错误：${error.message}`;
}
module.exports = { connectionError };

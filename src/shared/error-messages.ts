import type { ErrorCode } from './contracts.js';

/** Public authored error descriptions only; never raw upstream errors. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHORIZED: 'Service authentication required.',
  BAD_REQUEST: 'Request does not match an allowed operation.',
  NOT_FOUND: 'Requested operation or resource was not found.',
  METHOD_NOT_ALLOWED: 'Method not allowed.',
  BUSY: 'Service is busy; retry later.',
  TIMEOUT: 'Operation exceeded its deadline.',
  RESPONSE_TOO_LARGE: 'Result exceeds the response limit.',
  INTERNAL: 'Operation failed. Upstream details have been withheld.',
  CONFIG_MISSING: 'CLI configuration is unavailable on the OpenChamber Server host.',
  CONFIG_INVALID: 'Host configuration is invalid. Check it on the server; contents are not disclosed.',
  CONTEXT_NOT_FOUND: 'Selected CLI context is unavailable.',
  UNSUPPORTED: 'This connection mode is not supported. Kubernetes core mode cannot reuse an Argo CD token.',
  NETWORK_DISABLED: 'Argo CD network access is disabled in host settings; approval is required before validation.',
  AUTH_REQUIRED: 'Authentication failed. Log in again using the CLI on the OpenChamber Server host.',
  FORBIDDEN: 'The host Argo CD identity does not have permission for this operation.',
  UPSTREAM_UNAVAILABLE: 'Argo CD is unreachable or its TLS connection failed.',
  UPSTREAM_INVALID: 'Argo CD returned an unsupported response or redirect.',
  CANCELLED: 'The operation was cancelled.',
  EXPIRED: 'The task or snapshot has expired; start a new query.',
  RESOURCE_CHANGED: 'The resource no longer matches the selected tree snapshot. Reload the tree before inspecting this object.',
  CAPABILITY_UNAVAILABLE: 'The server version or API does not provide the requested capability. No fallback or refresh was attempted.',
};
export const CHINESE_ERRORS: Record<ErrorCode, string> = {
  UNAUTHORIZED: '需要 Service 身份认证。', BAD_REQUEST: '请求不符合允许的操作。', NOT_FOUND: '未找到请求的操作或资源。',
  METHOD_NOT_ALLOWED: '不允许此请求方法。', BUSY: 'Service 繁忙，请稍后重试。', TIMEOUT: '操作已超时。', RESPONSE_TOO_LARGE: '结果超过响应体积限制。',
  INTERNAL: '操作失败，上游详细信息已隐藏。', CONFIG_MISSING: 'OpenChamber Server 宿主上没有可用的 CLI 配置。',
  CONFIG_INVALID: '宿主配置无效，请在服务端检查；配置内容不会传输。', CONTEXT_NOT_FOUND: '所选 CLI context 不可用。',
  UNSUPPORTED: '不支持此连接模式；Kubernetes core 模式不能复用 Argo CD Token。', NETWORK_DISABLED: '宿主设置禁用了 Argo CD 网络访问，验证前需要授权。',
  AUTH_REQUIRED: '身份认证失败，请在 OpenChamber Server 宿主外部检查已有 CLI 登录态。', FORBIDDEN: '宿主 Argo CD 身份没有执行此操作的权限。',
  UPSTREAM_UNAVAILABLE: '无法连接 Argo CD，或 TLS 连接失败。', UPSTREAM_INVALID: 'Argo CD 返回了不支持的响应或重定向。', CANCELLED: '操作已取消。',
  EXPIRED: '任务或快照已过期，请开始新查询。', RESOURCE_CHANGED: '资源与所选树快照不再匹配，请重新读取资源树。',
  CAPABILITY_UNAVAILABLE: '服务端版本或 API 不提供此能力；未执行回退或刷新。',
};

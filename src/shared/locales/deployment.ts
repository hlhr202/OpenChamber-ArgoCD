/** Authored rollout chrome only. Upstream event reasons/messages stay opaque.
 * Other locales use explicit English fallbacks until reviewed translations land. */
export const deploymentEnglish: Record<string, string> = Object.fromEntries([
  'Historical ReplicaSets ({0})', 'Current', 'Current target unconfirmed', 'Application sync retries', 'Deployment and related resource events',
  'Event queries succeeded: {0} / {1}', '{0} resources omitted by the query limit; results are incomplete.',
  'Occurrence counts are aggregated Kubernetes events, not sync retries or container restarts. Events may predate this rollout; individual attempts cannot be reconstructed.',
  'Occurrences: {0}', 'Desired', 'Updated', 'Available', 'Generation', 'Observed generation',
  'Auto-update resource details', 'Include related resource events', 'Related resource events',
].map((key) => [key, key]));
export const deploymentChinese: Record<string, string> = {
  'Historical ReplicaSets ({0})': '历史 ReplicaSets（{0}）', 'Current': '当前', 'Application sync retries': '应用同步重试次数',
  'Current target unconfirmed': '当前版本未确认',
  'Deployment and related resource events': 'Deployment 及关联资源事件', 'Event queries succeeded: {0} / {1}': '事件查询成功：{0} / {1}',
  '{0} resources omitted by the query limit; results are incomplete.': '受查询上限限制，未读取 {0} 个资源；结果不完整。',
  'Occurrence counts are aggregated Kubernetes events, not sync retries or container restarts. Events may predate this rollout; individual attempts cannot be reconstructed.': '发生次数是 Kubernetes 聚合事件计数，不是同步重试或容器重启次数。事件可能早于本次发布，无法还原逐次尝试。',
  'Occurrences: {0}': '事件发生次数：{0}', 'Desired': '期望副本', 'Updated': '已更新副本', 'Available': '可用副本', 'Generation': 'Generation', 'Observed generation': '已观测 Generation',
  'Auto-update resource details': '自动更新资源详情', 'Include related resource events': '包含关联资源事件', 'Related resource events': '关联资源事件',
};

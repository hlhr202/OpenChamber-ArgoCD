import type { HostReadyContext, HostThemeTokens } from '@openchamber/sdk';

export function hostReady(mode: 'light' | 'dark' = 'light'): HostReadyContext {
  const background = mode === 'light' ? '#ffffff' : '#171717'; const foreground = mode === 'light' ? '#242424' : '#eeeeee';
  const colors = ['background', 'elevated', 'foreground', 'muted', 'subtle', 'border', 'hover', 'selection', 'focus', 'primary', 'mutedSurface', 'elevatedForeground', 'active', 'selectionForeground', 'primaryForeground', 'primaryText', 'successText', 'warningText', 'errorText', 'infoText', 'success', 'warning', 'error', 'info'];
  const tokens = Object.fromEntries(colors.map((name) => [name, foreground])) as HostThemeTokens;
  Object.assign(tokens, { background, elevated: background, foreground, muted: mode === 'light' ? '#666666' : '#aaaaaa', subtle: background, border: mode === 'light' ? '#dddddd' : '#444444', hover: mode === 'light' ? '#eeeeee' : '#333333', selection: mode === 'light' ? '#e8efff' : '#313b51', primary: '#426dcc', primaryText: mode === 'light' ? '#3157a3' : '#87aaff', primaryForeground: '#ffffff', focus: '#648cef', mutedSurface: background, elevatedForeground: foreground, active: background, selectionForeground: foreground, successText: '#4d9970', warningText: '#ad7d25', errorText: '#c65c5c', infoText: '#5b82b0', font: 'system-ui, sans-serif', mono: 'ui-monospace, monospace', radius: '6px' });
  return { theme: { mode, tokens }, locale: 'zh-CN', directory: '/synthetic/project', session: { id: 'synthetic-session', title: 'Synthetic test chat', busy: false }, surface: 'panel', connection: { connected: false, account: '' }, settings: {}, item: null, features: { deviceStorage: true } };
}

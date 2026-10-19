/** Localize authored SDK chrome only, never item data, input values or IDs. */
import * as sdk from '@openchamber/sdk/ui';
import { t } from './i18n.js';
export type { ButtonProps, SelectProps, SelectOption } from '@openchamber/sdk/ui';
function chrome<T extends object>(props: T): T {
  const result = { ...props } as Record<string, unknown>;
  for (const key of ['label', 'placeholder', 'searchPlaceholder', 'helper', 'error', 'ariaLabel', 'emptyText', 'title', 'body', 'description']) if (typeof result[key] === 'string') result[key] = t(result[key] as string);
  // Empty-ID rows are the authored All/default choice, not resource names.
  if (Array.isArray(result.options)) result.options = result.options.map((item: { id: string; label: string }) => item.id === '' ? { ...item, label: t(item.label) } : item);
  return result as T;
}
function localMount<P extends object, H extends { update: (props: Partial<P>) => void; dispose: () => void }>(mount: (root: Element, props: P) => H) {
  return (root: Element, props: P): H => {
    const handle = mount(root, chrome(props));
    return { ...handle, update: (next: Partial<P>) => handle.update(chrome(next)) };
  };
}
export const mountButton = localMount(sdk.mountButton);
const select = localMount(sdk.mountSelect);
export const mountSelect: typeof sdk.mountSelect = (root, props) => {
  const handle = select(root, { placeholder: '选择', searchPlaceholder: '搜索', ...props });
  // SDK 2.2 has one hard-coded empty-search notice and no locale prop. Only
  // that chrome node is rewritten; option labels/IDs/data are never traversed.
  const Observer = root.ownerDocument.defaultView?.MutationObserver;
  const observer = Observer ? new Observer(() => {
    for (const empty of root.querySelectorAll<HTMLElement>('.oc-sdk-popup-empty')) {
      const text = t('无匹配项'); if (empty.textContent !== text) empty.textContent = text;
    }
  }) : undefined;
  observer?.observe(root, { childList: true, subtree: true });
  return { ...handle, dispose(): void { observer?.disconnect(); handle.dispose(); } };
};
export const mountTextField = localMount(sdk.mountTextField);
export const mountSwitch = localMount(sdk.mountSwitch);
export const mountList = localMount(sdk.mountList);
export const mountBanner = localMount(sdk.mountBanner);
export const mountTabs: typeof sdk.mountTabs = (root, props) => sdk.mountTabs(root, { ...props, items: props.items.map((item) => ({ ...item, label: t(item.label) })) });

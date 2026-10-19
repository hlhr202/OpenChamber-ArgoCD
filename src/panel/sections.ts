import { mountTabs } from './ui.js';

let count = 0;
export function mountSections(root: HTMLElement, items: Array<{ id: string; label: string; pane: HTMLElement }>, initial: string, change: (id: string) => void) {
  const prefix = `observer-tabs-${++count}`; let active = items.some((item) => item.id === initial) ? initial : items[0]!.id;
  const tabs = mountTabs(root, { items: items.map(({ id, label }) => ({ id, label })), activeId: active, onChange: (id) => select(id) });
  function paint(): void {
    for (const item of items) {
      const tab = [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.dataset.id === item.id)!;
      tab.id = `${prefix}-${item.id}-tab`; tab.setAttribute('aria-controls', `${prefix}-${item.id}`);
      item.pane.id = `${prefix}-${item.id}`; item.pane.setAttribute('role', 'tabpanel'); item.pane.setAttribute('aria-labelledby', tab.id); item.pane.tabIndex = 0; item.pane.hidden = item.id !== active;
    }
  }
  function select(id: string): void {
    if (!items.some((item) => item.id === id)) return;
    active = id; tabs.update({ activeId: active }); paint(); change(active);
  }
  const rtlKeys = (event: KeyboardEvent) => {
    if (root.ownerDocument.documentElement.dir !== 'rtl' || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const target = event.target as HTMLElement; if (target.getAttribute('role') !== 'tab') return;
    const index = items.findIndex((item) => item.id === target.dataset.id); if (index < 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const next = items[(index + (event.key === 'ArrowLeft' ? 1 : -1) + items.length) % items.length]!;
    select(next.id); [...root.querySelectorAll<HTMLElement>('[role="tab"]')].find((tab) => tab.dataset.id === next.id)?.focus();
  };
  root.addEventListener('keydown', rtlKeys, true);
  paint(); return { select, dispose: () => { root.removeEventListener('keydown', rtlKeys, true); tabs.dispose(); } };
}

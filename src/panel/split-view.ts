import { mountIconButton } from './icon-button.js';
import { t } from './i18n.js';
import type { SplitState } from './navigation-state.js';

let id = 0;
export function mountSplitView(root: HTMLElement, options: { resource?: boolean; changed?: () => void; showList?: () => void } = {}) {
  const document = root.ownerDocument; const view = document.defaultView;
  root.classList.add('application-columns'); if (options.resource) root.classList.add('resource-columns'); root.dataset.detailOpen = 'false'; root.dataset.listCollapsed = 'false';
  const node = (tag: string, className: string, parent = root) => { const element = document.createElement(tag); element.className = className; parent.append(element); return element; };
  const sidebar = node('aside', 'application-sidebar'); sidebar.id = `observer-sidebar-${++id}`;
  const header = node('div', 'application-list-toolbar', sidebar); node('span', '', header).textContent = t(options.resource ? "Application resource tree" : 'Applications');
  const list = node('div', 'application-list-scroll', sidebar); list.setAttribute('aria-label', t(options.resource ? "Scrollable resource list" : "Scrollable application list"));
  const minimum = options.resource ? 180 : 220; const maximum = options.resource ? 360 : 420;
  const divider = node('div', 'application-divider'); divider.setAttribute('role', 'separator'); divider.setAttribute('aria-label', t(options.resource ? "Resize resource list" : "Resize application list")); divider.setAttribute('aria-orientation', 'vertical'); divider.setAttribute('aria-controls', sidebar.id); divider.setAttribute('aria-valuemin', String(minimum)); divider.setAttribute('aria-valuemax', String(maximum)); divider.tabIndex = 0;
  const pane = node('section', 'application-detail-pane'); const detailToolbar = node('div', 'application-detail-toolbar', pane);
  const detail = node('div', 'application-detail-content', pane); detail.setAttribute('aria-label', t(options.resource ? "Resource details and events" : "Application details")); detail.dataset.emptyLabel = t(options.resource ? "Select a resource to view details" : "Select an application to view details");
  let width = options.resource ? 220 : 280; let drag: { pointer: number; x: number; width: number } | undefined;
  const direction = () => document.documentElement.dir === 'rtl' ? -1 : 1;
  function resize(next: number): void { width = Math.max(minimum, Math.min(maximum, next)); root.style.setProperty('--application-list-width', `${width}px`); divider.setAttribute('aria-valuenow', String(Math.round(width))); }
  function showList(): void { options.showList?.(); root.dataset.listCollapsed = 'false'; root.dataset.detailOpen = 'false'; expand.button.setAttribute('aria-expanded', 'true'); list.querySelector<HTMLElement>('[role="treeitem"][tabindex="0"], [role="listbox"]')?.focus(); options.changed?.(); }
  function stop(): void { const old = drag; drag = undefined; if (old && divider.hasPointerCapture?.(old.pointer)) divider.releasePointerCapture(old.pointer); root.classList.remove('is-resizing'); }
  const collapse = mountIconButton(header, { icon: 'collapse', label: options.resource ? "Collapse resource list" : "Collapse application list", onClick: () => { stop(); root.dataset.listCollapsed = 'true'; expand.button.setAttribute('aria-expanded', 'false'); expand.button.focus(); options.changed?.(); } });
  const expand = mountIconButton(detailToolbar, { icon: 'expand', label: options.resource ? "Expand resource list" : "Expand application list", tooltip: options.resource ? "Back to resource list" : "Expand application list / back to list", onClick: showList });
  expand.button.setAttribute('aria-controls', sidebar.id); expand.button.setAttribute('aria-expanded', 'true');
  expand.button.classList.add('observer-return-button'); expand.button.querySelector('.visually-hidden')?.classList.remove('visually-hidden');
  const returnControl = expand.button.parentElement!; returnControl.classList.add('application-return-control');
  const down = (event: PointerEvent) => { if (event.button !== 0) return; drag = { pointer: event.pointerId, x: event.clientX, width }; divider.setPointerCapture?.(event.pointerId); root.classList.add('is-resizing'); event.preventDefault(); };
  const move = (event: PointerEvent) => { if (drag?.pointer === event.pointerId) { resize(drag.width + (event.clientX - drag.x) * direction()); options.changed?.(); } };
  const key = (event: KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); resize(event.key === 'Home' ? minimum : event.key === 'End' ? maximum : width + (event.key === 'ArrowLeft' ? -16 : 16) * direction());
    options.changed?.();
  };
  divider.addEventListener('pointerdown', down); divider.addEventListener('pointermove', move); divider.addEventListener('pointerup', stop); divider.addEventListener('pointercancel', stop); divider.addEventListener('lostpointercapture', stop); divider.addEventListener('keydown', key);
  view?.addEventListener('blur', stop); document.addEventListener('visibilitychange', stop); resize(width);
  return { list, detail, stopResize: stop,
    setHeader(header?: HTMLElement): void { detailToolbar.hidden = Boolean(header); if (header) header.prepend(returnControl); else detailToolbar.append(returnControl); },
    // Derived navigation mode, deliberately separate from persisted user layout.
    setDetailOnly(value: boolean): void { root.dataset.detailOnly = String(value); expand.button.setAttribute('aria-expanded', String(!value && root.dataset.listCollapsed !== 'true')); },
    captureState(): SplitState { return { width, collapsed: root.dataset.listCollapsed === 'true', detailOpen: root.dataset.detailOpen === 'true' }; },
    restoreState(state: SplitState): void { resize(state.width); root.dataset.listCollapsed = String(state.collapsed); root.dataset.detailOpen = String(state.detailOpen); expand.button.setAttribute('aria-expanded', String(!state.collapsed)); },
    openDetail(): void { root.dataset.detailOpen = 'true'; }, reset(): void { stop(); root.dataset.detailOpen = 'false'; root.dataset.listCollapsed = 'false'; expand.button.setAttribute('aria-expanded', 'true'); }, dispose(): void {
    stop(); collapse.dispose(); expand.dispose(); divider.removeEventListener('pointerdown', down); divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', stop); divider.removeEventListener('pointercancel', stop); divider.removeEventListener('lostpointercapture', stop); divider.removeEventListener('keydown', key); view?.removeEventListener('blur', stop); document.removeEventListener('visibilitychange', stop); root.replaceChildren();
  } };
}

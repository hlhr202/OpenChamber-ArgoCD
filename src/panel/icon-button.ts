import { mountButton, type ButtonProps } from './ui.js';
import { t } from './i18n.js';

const paths = {
  contexts: 'M3 7h7l2 2h9v11H3z M3 7V4h7l2 3',
  reload: 'M20 10a8 8 0 1 0-1 7 M20 4v6h-6',
  clock: 'M12 7v5l3 2 M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  close: 'm6 6 12 12 M18 6 6 18',
  collapse: 'm14 6-6 6 6 6 M20 4v16',
  expand: 'm10 6 6 6-6 6 M4 4v16',
  reset: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  check: 'm5 12 4 4L19 6',
  page: 'M9 3H3v18h18v-6 M14 3h7v7 M21 3l-11 11',
} as const;
type IconProps = ButtonProps & { icon: keyof typeof paths; tooltip?: string; pressed?: boolean };
let tooltipId = 0;

/** SDK button semantics, with local SVG and a bounded keyboard/hover tooltip.
 * Labels remain in the DOM for accessibility; never uses HTML from data. */
export function mountIconButton(root: HTMLElement, initial: IconProps) {
  const slot = root.ownerDocument.createElement('span'); slot.className = 'observer-icon-control'; root.append(slot);
  let props = initial; const handle = mountButton(slot, { variant: 'ghost', size: 'sm', ...props });
  const button = slot.querySelector('button')!; button.classList.add('observer-icon-button');
  button.querySelector('span')!.classList.add('visually-hidden');
  const svg = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const path = root.ownerDocument.createElementNS(svg.namespaceURI, 'path'); svg.append(path); button.prepend(svg);
  const tooltip = root.ownerDocument.createElement('div'); tooltip.id = `observer-tooltip-${++tooltipId}`; tooltip.className = 'observer-tooltip'; tooltip.setAttribute('role', 'tooltip');
  const document = root.ownerDocument; const view = document.defaultView; let showing = false;
  function hide(): void { showing = false; tooltip.remove(); button.removeAttribute('aria-describedby'); }
  function show(): void {
    if (button.disabled || document.hidden) return;
    tooltip.textContent = t(props.tooltip ?? props.label); document.body.append(tooltip); showing = true; button.setAttribute('aria-describedby', tooltip.id);
    const anchor = button.getBoundingClientRect(); const box = tooltip.getBoundingClientRect();
    const width = view?.innerWidth ?? 360; const height = view?.innerHeight ?? 600;
    tooltip.style.left = `${Math.max(8, Math.min(anchor.left, width - box.width - 8))}px`;
    tooltip.style.top = `${Math.max(8, anchor.bottom + box.height + 12 <= height ? anchor.bottom + 6 : anchor.top - box.height - 6)}px`;
  }
  function paint(): void {
    path.setAttribute('d', paths[props.icon]); button.setAttribute('aria-label', t(props.label));
    if (props.pressed === undefined) button.removeAttribute('aria-pressed'); else button.setAttribute('aria-pressed', String(props.pressed));
    if (props.loading || props.disabled) hide(); else if (showing) show();
  }
  const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') hide(); };
  button.addEventListener('pointerenter', show); button.addEventListener('pointerleave', hide); button.addEventListener('focus', show); button.addEventListener('blur', hide); button.addEventListener('keydown', escape);
  document.addEventListener('scroll', hide, true); document.addEventListener('visibilitychange', hide); view?.addEventListener('resize', hide);
  paint();
  return { button, update(next: Partial<IconProps>): void { props = { ...props, ...next }; handle.update(next); paint(); }, dispose(): void {
    hide(); button.removeEventListener('pointerenter', show); button.removeEventListener('pointerleave', hide); button.removeEventListener('focus', show); button.removeEventListener('blur', hide); button.removeEventListener('keydown', escape);
    document.removeEventListener('scroll', hide, true); document.removeEventListener('visibilitychange', hide); view?.removeEventListener('resize', hide); handle.dispose(); slot.remove();
  } };
}

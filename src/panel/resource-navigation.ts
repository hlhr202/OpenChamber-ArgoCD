import type { ResourceNode, ResourceTree } from '../shared/resources.js';
import { mountSwitch, mountTextField } from './ui.js';
import { t } from './i18n.js';

export interface NavigationRow { node: ResourceNode; depth: number; parent: string | null; children: string[] }
/** One spanning forest for navigation, never a replacement for the original DAG.
 * Orphan nodes stay in a separate group; cycles and extra parents remain metadata. */
export function navigationRows(tree: ResourceTree): NavigationRow[] {
  const nodes = new Map(tree.nodes.map((node) => [node.id, node])); const seen = new Set<string>(); const rows: NavigationRow[] = [];
  for (const root of [...tree.roots, ...tree.nodes.map((node) => node.id)]) {
    const stack = [{ id: root, depth: 0, parent: null as string | null }];
    while (stack.length) {
      const item = stack.pop()!; const node = nodes.get(item.id); if (!node || seen.has(item.id)) continue;
      const parent = item.parent ? nodes.get(item.parent) : undefined;
      if (parent && parent.orphaned !== node.orphaned) continue;
      seen.add(item.id); rows.push({ node, depth: item.depth, parent: item.parent, children: [] });
      for (const child of [...node.children].reverse()) stack.push({ id: child, depth: item.depth + 1, parent: node.id });
    }
  }
  const indexed = new Map(rows.map((row) => [row.node.id, row]));
  for (const row of rows) if (row.parent) indexed.get(row.parent)?.children.push(row.node.id);
  return rows;
}
export function anomalous(node: ResourceNode): boolean { return node.health !== 'Healthy'; }
export function mountResourceNavigation(root: HTMLElement, select: (id: string) => void, filteredOut: () => void) {
  const document = root.ownerDocument; root.classList.add('resource-navigation');
  let rows: NavigationRow[] = []; let indexed = new Map<string, NavigationRow>(); let selected = ''; let focused = ''; let query = ''; let onlyAnomalies = false;
  const expanded = new Set<string>(); const filterCollapsed = new Set<string>(); let visibleRows: NavigationRow[] = [];
  const controls = document.createElement('div'); controls.className = 'resource-tree-controls'; root.append(controls);
  const search = mountTextField(controls, { label: '筛选资源（名称 / Namespace / Kind / Health / orphaned）', placeholder: '搜索资源…', value: '', onChange: (value) => { query = value; search.update({ value }); paint(true); } });
  const toggle = mountSwitch(controls, { label: '仅看异常', checked: false, onChange: (value) => { onlyAnomalies = value; toggle.update({ checked: value }); paint(true); } });
  const tree = document.createElement('div'); tree.className = 'resource-tree'; tree.setAttribute('role', 'tree'); tree.setAttribute('aria-label', t('应用资源树')); root.append(tree);
  function ancestors(id: string, visit: (id: string) => void): void {
    let parent = indexed.get(id)?.parent;
    while (parent) { visit(parent); parent = indexed.get(parent)?.parent; }
  }
  function focus(id: string): void {
    focused = id; for (const row of tree.querySelectorAll<HTMLElement>('[role="treeitem"]')) { row.tabIndex = row.dataset.resourceId === id ? 0 : -1; if (row.tabIndex === 0) row.focus(); }
  }
  function paint(filterChanged = false): void {
    const hadFocus = tree.contains(document.activeElement); const include = new Set<string>(); if (filterChanged) filterCollapsed.clear();
    const needle = query.trim().toLowerCase();
    for (const { node } of rows) if ((!onlyAnomalies || anomalous(node)) && `${node.kind} ${node.name} ${node.namespace} ${node.health} ${node.orphaned ? 'orphaned' : ''}`.toLowerCase().includes(needle)) { include.add(node.id); ancestors(node.id, (id) => include.add(id)); }
    if (filterChanged && selected && !include.has(selected)) { selected = ''; filteredOut(); }
    visibleRows = rows.filter((row) => {
      if (!include.has(row.node.id)) return false;
      let parent = row.parent; while (parent) { if (needle || onlyAnomalies ? filterCollapsed.has(parent) : !expanded.has(parent)) return false; parent = indexed.get(parent)?.parent ?? null; } return true;
    });
    if (!visibleRows.some((row) => row.node.id === focused)) focused = visibleRows.find((row) => row.node.id === selected)?.node.id ?? visibleRows[0]?.node.id ?? '';
    tree.replaceChildren();
    for (const orphaned of [false, true]) {
      const group = visibleRows.filter((row) => row.node.orphaned === orphaned); if (!group.length) continue;
      if (orphaned) { const label = document.createElement('div'); label.className = 'resource-tree-group'; label.textContent = t('孤立资源'); label.setAttribute('role', 'presentation'); tree.append(label); }
      for (const { node, depth, children } of group) {
        const row = document.createElement('div'); row.className = 'resource-tree-row'; row.dataset.resourceId = node.id; row.dataset.kind = node.kind; row.dataset.namespace = node.namespace; row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(depth + 1)); row.setAttribute('aria-selected', String(node.id === selected)); row.tabIndex = node.id === focused ? 0 : -1;
        const hasChildren = children.some((id) => include.has(id)); const isExpanded = needle || onlyAnomalies ? !filterCollapsed.has(node.id) : expanded.has(node.id); if (hasChildren) row.setAttribute('aria-expanded', String(isExpanded));
        row.style.setProperty('--resource-depth', String(Math.min(depth, 8)));
        row.title = `${node.kind} · ${node.namespace || '(cluster)'}/${node.name} · ${node.health}\n${node.healthMessage}\n${node.parents.length} ${t('关联父资源')}${node.unresolvedParents ? ` · ${t('父引用未解析')}` : ''}`;
        row.setAttribute('aria-label', row.title);
        const arrow = document.createElement('span'); arrow.className = 'resource-tree-arrow'; arrow.setAttribute('aria-hidden', 'true'); if (hasChildren) { arrow.textContent = isExpanded ? '▾' : '▸'; arrow.dataset.toggle = 'true'; } row.append(arrow);
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); icon.setAttribute('viewBox', '0 0 16 16'); icon.setAttribute('aria-hidden', 'true'); icon.classList.add('resource-kind-icon');
        const path = document.createElementNS(icon.namespaceURI, 'path');
        path.setAttribute('d', node.kind === 'Pod' ? 'M8 1 14 4.5v7L8 15l-6-3.5v-7L8 1Zm-6 3.5L8 8l6-3.5M8 8v7' : /Deployment|ReplicaSet|StatefulSet|DaemonSet/.test(node.kind) ? 'M2 2h9v9H2zM5 5h9v9H5' : node.kind === 'Service' ? 'M8 3v5M3 12V8h10v4M1 12h4v3H1zm10 0h4v3h-4zM6 1h4v3H6z' : node.kind === 'Secret' ? 'M7 6a3 3 0 1 0-6 0 3 3 0 0 0 6 0Zm0 0h8m-3 0v3m3-3v2' : 'M3 1h7l3 3v11H3zM10 1v4h3M5 8h6M5 11h4');
        icon.append(path); row.append(icon);
        const name = document.createElement('span'); name.className = 'resource-tree-name'; name.textContent = node.name; row.append(name);
        if (node.parents.length > 1 || node.unresolvedParents) { const linked = document.createElement('span'); linked.className = 'resource-tree-linked'; linked.textContent = node.unresolvedParents ? '↗?' : `↗${node.parents.length}`; linked.setAttribute('aria-hidden', 'true'); row.append(linked); }
        const status = document.createElement('span'); status.className = 'resource-health-dot'; status.dataset.health = node.health; status.dataset.tone = node.health === 'Healthy' ? 'success' : ['Degraded', 'Missing'].includes(node.health) ? 'error' : node.health === 'Progressing' || node.health === 'Suspended' ? 'warning' : 'unknown'; status.setAttribute('aria-hidden', 'true'); row.append(status); tree.append(row);
      }
    }
    if (!visibleRows.length) { const empty = document.createElement('p'); empty.className = 'description'; empty.textContent = t('当前快照没有匹配资源；不等于集群中没有资源'); tree.append(empty); }
    if (hadFocus && focused) focus(focused);
  }
  const click = (event: MouseEvent) => {
    const target = event.target as Element; const row = target.closest<HTMLElement>('[role="treeitem"]'); if (!row) return; const id = row.dataset.resourceId!; focused = id;
    if (target.closest('[data-toggle]')) { if (query.trim() || onlyAnomalies) { if (filterCollapsed.has(id)) filterCollapsed.delete(id); else filterCollapsed.add(id); } else if (expanded.has(id)) expanded.delete(id); else expanded.add(id); paint(); focus(id); }
    else { select(id); }
  };
  const key = (event: KeyboardEvent) => {
    const item = (event.target as Element).closest<HTMLElement>('[role="treeitem"]'); if (!item) return;
    const id = item.dataset.resourceId!; const index = visibleRows.findIndex((row) => row.node.id === id); const row = visibleRows[index]; if (!row) return;
    const rtl = document.documentElement.dir === 'rtl'; const open = rtl ? 'ArrowLeft' : 'ArrowRight'; const close = rtl ? 'ArrowRight' : 'ArrowLeft';
    if (['ArrowDown', 'ArrowUp', 'Home', 'End', open, close, 'Enter', ' '].includes(event.key)) event.preventDefault(); else return;
    if (event.key === 'Enter' || event.key === ' ') select(id);
    else if (event.key === open) { if (row.children.length && item.getAttribute('aria-expanded') !== 'true') { expanded.add(id); filterCollapsed.delete(id); paint(); focus(id); } else if (row.children.length) { const child = visibleRows.find((item) => item.parent === id); if (child) focus(child.node.id); } }
    else if (event.key === close) { if (item.getAttribute('aria-expanded') === 'true') { expanded.delete(id); if (query.trim() || onlyAnomalies) filterCollapsed.add(id); paint(); focus(id); } else if (row.parent) focus(row.parent); }
    else focus(visibleRows[event.key === 'Home' ? 0 : event.key === 'End' ? visibleRows.length - 1 : Math.max(0, Math.min(visibleRows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)))]!.node.id);
  };
  tree.addEventListener('click', click); tree.addEventListener('keydown', key);
  return {
    setTree(value: ResourceTree): void { rows = navigationRows(value); indexed = new Map(rows.map((row) => [row.node.id, row])); expanded.clear(); filterCollapsed.clear(); for (const row of rows) if (anomalous(row.node)) ancestors(row.node.id, (id) => expanded.add(id)); paint(); },
    clear(): void { rows = []; indexed.clear(); selected = ''; focused = ''; expanded.clear(); filterCollapsed.clear(); paint(); },
    select(id: string): void { if (!visibleRows.some((row) => row.node.id === id)) { query = ''; onlyAnomalies = false; search.update({ value: '' }); toggle.update({ checked: false }); } selected = id; focused = id; ancestors(id, (parent) => { expanded.add(parent); filterCollapsed.delete(parent); }); paint(); },
    dispose(): void { tree.removeEventListener('click', click); tree.removeEventListener('keydown', key); search.dispose(); toggle.dispose(); root.replaceChildren(); },
  };
}

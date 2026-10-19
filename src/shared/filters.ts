import type { ApplicationFilters, ApplicationSummary } from './applications.js';

// Kubernetes label-selector clauses split on commas outside set expressions.
// Invalid selectors throw rather than turning into an empty-success result.
export function labelSelector(selector: string): (labels: Record<string, string>) => boolean {
  if (selector.length > 512) throw new Error('Invalid label selector');
  const clauses: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    if (selector[i] === '(') depth++;
    if (selector[i] === ')') depth--;
    if (depth < 0 || depth > 1) throw new Error('Invalid label selector');
    if (selector[i] === ',' && !depth) { clauses.push(selector.slice(start, i).trim()); start = i + 1; }
  }
  if (depth) throw new Error('Invalid label selector');
  clauses.push(selector.slice(start).trim());
  if (!selector.trim()) return () => true;
  const keyPattern = /^(?:[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\/)?[a-zA-Z0-9](?:[a-zA-Z0-9_.-]*[a-zA-Z0-9])?$/;
  const valuePattern = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9_.-]*[a-zA-Z0-9])?)?$/;
  const checks = clauses.map((clause) => {
    const set = /^([^\s!=(),]+)\s+(in|notin)\s*\(([^()]*)\)$/.exec(clause);
    const equality = /^([^\s!=(),]+)\s*(==|!=|=)\s*([^,()]*)$/.exec(clause);
    if (set) {
      const key = set[1]!;
      const values = set[3]!.split(',').map((v) => v.trim());
      if (!keyPattern.test(key) || values.some((v) => !valuePattern.test(v))) throw new Error('Invalid label selector');
      return (labels: Record<string, string>) => set[2] === 'in'
        ? Object.hasOwn(labels, key) && values.includes(labels[key]!)
        : !Object.hasOwn(labels, key) || !values.includes(labels[key]!);
    }
    if (equality) {
      const key = equality[1]!;
      const value = equality[3]!.trim();
      if (!keyPattern.test(key) || !valuePattern.test(value)) throw new Error('Invalid label selector');
      return (labels: Record<string, string>) => equality[2] === '!='
        ? !Object.hasOwn(labels, key) || labels[key] !== value
        : Object.hasOwn(labels, key) && labels[key] === value;
    }
    const absent = clause.startsWith('!');
    const key = absent ? clause.slice(1) : clause;
    if (!keyPattern.test(key)) throw new Error('Invalid label selector');
    return (labels: Record<string, string>) => absent !== Object.hasOwn(labels, key);
  });
  return (labels) => checks.every((check) => check(labels));
}

export function filterApplications(items: ApplicationSummary[], filters: ApplicationFilters): ApplicationSummary[] {
  const matches = labelSelector(filters.selector ?? '');
  return items.filter((item) =>
    (!filters.name || item.name.toLocaleLowerCase().includes(filters.name.toLocaleLowerCase())) &&
    (!filters.appNamespace || item.appNamespace === filters.appNamespace) &&
    (!filters.project || item.project === filters.project) &&
    (!filters.cluster || item.destination.name === filters.cluster || item.destination.server === filters.cluster) &&
    (!filters.destinationNamespace || item.destination.namespace === filters.destinationNamespace) &&
    (!filters.repo || item.sources.some((source) => source.repoURL === filters.repo)) &&
    (!filters.sync || item.sync === filters.sync) && (!filters.health || item.health === filters.health) && matches(item.labels),
  );
}

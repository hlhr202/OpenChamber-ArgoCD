export interface ApplicationReference { name: string; appNamespace: string }
export interface ResourceReference {
  group: string; version: string; kind: string; namespace: string; name: string; uid: string;
}
export interface ResourceNode extends ResourceReference {
  id: string; parents: string[]; children: string[]; unresolvedParents: number;
  orphaned: boolean; health: string; healthMessage: string; createdAt: string; images: string[];
  replicaSet?: { revision: number | null; desired: number | null; replicas: number | null; current: boolean | null };
}
export interface ResourceTree {
  nodes: ResourceNode[]; roots: string[]; warnings: string[];
  orphanedMonitoring: 'enabled' | 'unknown';
}
export interface OrphanedMonitoring { state: 'enabled' | 'disabled'; warn: boolean | null }
export interface LiveResource {
  reference: ResourceReference;
  manifest: Record<string, unknown>;
  redactionNotice: string;
  workload?: WorkloadStatus;
  pod: null | {
    phase: string; reason: string; message: string;
    containers: Array<{ name: string; image: string; ready: boolean | null; restarts: number | null; phase: string; reason: string; message: string }>;
  };
}
export interface WorkloadStatus {
  desired: number | null; replicas: number | null; ready: number | null; updated: number | null; available: number | null;
  generation: number | null; observedGeneration: number | null;
  conditions: Array<{ type: string; status: string; reason: string; message: string }>;
}
export interface ResourceEvent {
  id: string; namespace: string; type: string; reason: string; message: string;
  firstTime: string; lastTime: string; count: number | null; source: string;
  resource: ResourceReference;
}
export interface EventList {
  items: ResourceEvent[]; excludedCount: number; instanceScoped: boolean; scope: 'application' | 'resource' | 'application-set' | 'related';
  related?: { total: number; omitted: number; resources: Array<{ resource: ResourceReference; eventsError?: string; liveError?: string; pod?: LiveResource['pod'] }> };
}

export function resourceCoordinate(ref: Pick<ResourceReference, 'group' | 'kind' | 'namespace' | 'name'>): string {
  return JSON.stringify([ref.group, ref.kind, ref.namespace, ref.name]);
}
export function resourceId(ref: ResourceReference): string { return JSON.stringify([ref.group, ref.kind, ref.namespace, ref.name, ref.uid]); }

/** Nonrecursive, cycle-safe outline: every node appears at most once, while
 * all parent links remain available in node metadata for multi-parent DAGs. */
export function resourceOutline(tree: ResourceTree): Array<{ node: ResourceNode; depth: number }> {
  const nodes = new Map(tree.nodes.map((node) => [node.id, node]));
  const seen = new Set<string>();
  const rows: Array<{ node: ResourceNode; depth: number }> = [];
  const visit = (id: string) => {
    const stack = [{ id, depth: 0 }];
    while (stack.length) {
      const current = stack.pop()!;
      const node = nodes.get(current.id);
      if (!node || seen.has(current.id)) continue;
      seen.add(current.id); rows.push({ node, depth: current.depth });
      for (const child of [...node.children].reverse()) stack.push({ id: child, depth: current.depth + 1 });
    }
  };
  for (const id of tree.roots) visit(id);
  for (const node of tree.nodes) if (!seen.has(node.id)) visit(node.id);
  return rows;
}

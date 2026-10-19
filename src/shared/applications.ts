export interface SourceSummary {
  repoURL: string;
  path: string;
  chart: string;
  targetRevision: string;
  name: string;
  ref: string;
  type: string;
}

export interface SourceDetail extends SourceSummary {
  helm: null | {
    releaseName: string; valueFiles: string[]; parameterNames: string[];
    fileParameterNames: string[]; hasInlineValues: boolean; hasValuesObject: boolean;
  };
  kustomize: null | {
    version: string; namePrefix: string; nameSuffix: string; namespace: string;
    images: string[]; components: string[]; commonLabelKeys: string[];
    commonAnnotationKeys: string[]; patchCount: number;
  };
}

export interface ApplicationSummary {
  id: string;
  name: string;
  appNamespace: string;
  project: string;
  destination: { server: string; name: string; namespace: string };
  labels: Record<string, string>;
  sync: string;
  health: string;
  syncKnown: boolean;
  healthKnown: boolean;
  comparedRevisions: string[];
  lastDeploymentRevisions: string[];
  lastDeploymentAt: string;
  sources: SourceSummary[];
  multipleSources: boolean;
  conditionsCount: number;
  operationPhase: string;
  reconciledAt: string;
}

export interface OperationResource {
  group: string; kind: string; namespace: string; name: string;
  status: string; syncPhase: string; hookPhase: string; message: string;
}

export interface ApplicationDetail extends ApplicationSummary {
  sources: SourceDetail[];
  conditions: Array<{ type: string; message: string; lastTransitionTime: string }>;
  operation: null | {
    phase: string; message: string; startedAt: string; finishedAt: string;
    retryCount: number; revisions: string[]; resources: OperationResource[];
  };
  history: Array<{
    id: string; revisions: string[]; deployedAt: string; deployStartedAt: string;
    initiatedBy: { username: string; automated: boolean }; sources: SourceDetail[];
  }>;
}

export interface ApplicationFilters {
  name?: string;
  appNamespace?: string;
  project?: string;
  cluster?: string;
  destinationNamespace?: string;
  repo?: string;
  selector?: string;
  sync?: string;
  health?: string;
}

export interface ApplicationCounts {
  total: number; outOfSync: number; unhealthy: number; unknown: number; withConditions: number;
}

export interface ApplicationList {
  items: ApplicationSummary[];
  totals: ApplicationCounts;
  matched: ApplicationCounts;
}

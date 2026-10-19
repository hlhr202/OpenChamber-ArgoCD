export interface ViewPreferences { density: 'compact' | 'comfortable'; module: 'applications' | 'management' | 'summary' }
export const DEFAULT_PREFERENCES: ViewPreferences = { density: 'compact', module: 'applications' };
export function viewPreferences(value: unknown): ViewPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...DEFAULT_PREFERENCES };
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some((key) => !['density', 'module'].includes(key)) || !['compact', 'comfortable'].includes(String(input.density)) || !['applications', 'management', 'summary'].includes(String(input.module))) return { ...DEFAULT_PREFERENCES };
  return { density: input.density as ViewPreferences['density'], module: input.module as ViewPreferences['module'] };
}

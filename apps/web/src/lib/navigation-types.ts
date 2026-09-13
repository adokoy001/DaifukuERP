import type { Label } from '../api/types.ts';

export type WorkspaceId = 'sales' | 'inventory' | 'workforce' | 'finance' | 'operations' | 'reports' | 'admin' | 'other';
export type NavigationKind = 'workspace' | 'record' | 'report' | 'action' | 'setting';
export interface NavigationEntry {
  /** Canonical application href; stable across locale changes and duplicate menu declarations. */
  id: string;
  href: string;
  label: Label;
  description?: Label;
  workspace: WorkspaceId;
  kind: NavigationKind;
  module?: string;
  featured: boolean;
  /** Other names for the same destination, including its module's bilingual label. */
  aliases: Label[];
}
export interface WorkspaceDefinition { id: WorkspaceId; label: Label; description: Label }
export interface NavigationWorkspace extends WorkspaceDefinition { entries: NavigationEntry[] }
export interface NavigationCatalog { entries: NavigationEntry[]; workspaces: NavigationWorkspace[] }

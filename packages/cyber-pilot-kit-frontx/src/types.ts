export interface KitManifestMeta {
  version: string;
  name?: string;
  description?: string;
}

export interface KitResourceEntry {
  id: string;
  source: string;
  default_path: string;
  type: 'file' | 'directory';
  user_modifiable?: boolean;
}

export interface KitManifest {
  manifest: KitManifestMeta;
  resources: KitResourceEntry[];
}

export interface ValidationViolation {
  field: string;
  code: string;
  message: string;
}

export type ValidationResult =
  | { status: 'PASS'; violations: [] }
  | { status: 'FAIL'; violations: ValidationViolation[] };

export interface KitRegistration {
  format: string;
  path: string;
  version: string;
  source: string;
}

export interface KitCapability {
  id: string;
  path: string;
  type: 'file' | 'directory';
}

export interface KitSessionResult {
  state: 'PACKAGED' | 'INSTALLED' | 'SESSION_ACTIVE';
  capabilities: KitCapability[];
  errors: string[];
  warnings: string[];
}

/**
 * Reads the actual shipped body text of a declared kit resource
 * (cpt-frontx-adr-solution-ai-content-placement self-validation). For a
 * `directory` resource, returns one string per file found recursively under
 * the resource's source path.
 */
export interface ResourceBodyReader {
  read(entry: KitResourceEntry): string[];
}

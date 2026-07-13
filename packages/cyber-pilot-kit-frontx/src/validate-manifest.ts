// @cpt-algo:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1
import type { KitManifest, ValidationResult, ValidationViolation } from './types.js';

const SOLUTION_TERMS = ['react', 'vue', 'angular', 'svelte', 'template', 'solution', 'screenset', 'studio'];

// @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-required-fields
function checkRequiredFields(manifest: unknown, violations: ValidationViolation[]): manifest is KitManifest {
  if (
    typeof manifest !== 'object' ||
    manifest === null ||
    !('manifest' in manifest) ||
    typeof (manifest as KitManifest).manifest !== 'object'
  ) {
    violations.push({ field: 'manifest', code: 'MISSING_REQUIRED_FIELD', message: 'manifest section is required' });
    return false;
  }
  if (!('resources' in manifest) || !Array.isArray((manifest as KitManifest).resources)) {
    violations.push({ field: 'resources', code: 'MISSING_REQUIRED_FIELD', message: 'resources array is required' });
    return false;
  }
  return true;
}
// @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-required-fields

// @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-version
function checkVersion(meta: KitManifest['manifest'], violations: ValidationViolation[]): void {
  if (!meta.version || typeof meta.version !== 'string' || !meta.version.trim()) {
    violations.push({ field: 'manifest.version', code: 'MISSING_VERSION', message: 'manifest.version is required and must be non-empty' });
  }
}
// @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-version

// @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-resources-array
function checkResourcesArray(resources: unknown[], violations: ValidationViolation[]): void {
  if (resources.length === 0) {
    violations.push({ field: 'resources', code: 'EMPTY_RESOURCES', message: 'resources must be a non-empty array' });
  }
}
// @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-resources-array

// @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-for-each-entry
function checkEntry(entry: unknown, index: number, violations: ValidationViolation[]): void {
  if (typeof entry !== 'object' || entry === null) {
    violations.push({ field: `resources[${index}]`, code: 'INVALID_ENTRY', message: 'resource entry must be an object' });
    return;
  }
  const e = entry as Record<string, unknown>;

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-entry-required
  for (const required of ['id', 'source', 'default_path', 'type']) {
    if (!e[required] || typeof e[required] !== 'string') {
      violations.push({ field: `resources[${index}].${required}`, code: 'MISSING_REQUIRED_FIELD', message: `${required} is required` });
    }
  }
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-entry-required

  const id = typeof e.id === 'string' ? e.id : '';

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-id-pattern
  if (id && !/^[a-z][a-z0-9_]*$/.test(id)) {
    violations.push({ field: `resources[${index}].id`, code: 'INVALID_ID_PATTERN', message: `id "${id}" must match ^[a-z][a-z0-9_]*$` });
  }
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-id-pattern

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-frontx-prefix
  if (id && /^[a-z][a-z0-9_]*$/.test(id) && !id.startsWith('frontx_')) {
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-prefix-fail
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-record-prefix-violation
    violations.push({ field: `resources[${index}].id`, code: 'MISSING_FRONTX_PREFIX', message: `resource id "${id}" does not carry the required frontx_ prefix (KIT-1)` });
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-record-prefix-violation
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-prefix-fail
  }
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-frontx-prefix

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-type-enum
  if (e.type && e.type !== 'file' && e.type !== 'directory') {
    violations.push({ field: `resources[${index}].type`, code: 'INVALID_TYPE', message: `type must be "file" or "directory", got "${e.type}"` });
  }
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-check-type-enum
}
// @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-for-each-entry

// @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-scan-solution-content
function checkSolutionContent(entry: unknown, index: number, violations: ValidationViolation[]): void {
  if (typeof entry !== 'object' || entry === null) return;
  const e = entry as Record<string, unknown>;
  const id = typeof e.id === 'string' ? e.id : '';
  const description = typeof e.description === 'string' ? e.description : '';
  const combined = `${id} ${description}`.toLowerCase();
  const found = SOLUTION_TERMS.find((term) => {
    const re = new RegExp(`(?<![a-z])${term}(?![a-z])`, 'i');
    return re.test(combined);
  });
  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-solution-content
  if (found) {
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-record-solution-violation
    violations.push({
      field: `resources[${index}].id`,
      code: 'SOLUTION_SPECIFIC_CONTENT',
      message: `resource id or description "${id}" appears to contain solution-specific content ("${found}"), which is prohibited by cpt-frontx-adr-base-solution-ai-content-split`,
    });
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-record-solution-violation
  }
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-solution-content
}
// @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-scan-solution-content

export function validateKitManifest(manifest: unknown): ValidationResult {
  const violations: ValidationViolation[] = [];

  if (!checkRequiredFields(manifest, violations)) {
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-violations
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-return-fail
    return { status: 'FAIL', violations };
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-return-fail
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-violations
  }

  const m = manifest as KitManifest;

  checkVersion(m.manifest, violations);
  checkResourcesArray(m.resources, violations);

  for (let i = 0; i < m.resources.length; i++) {
    checkEntry(m.resources[i], i, violations);
    checkSolutionContent(m.resources[i], i, violations);
  }

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-violations
  if (violations.length > 0) {
    // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-return-fail
    return { status: 'FAIL', violations };
    // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-return-fail
  }
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-if-violations

  // @cpt-begin:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-return-pass
  return { status: 'PASS', violations: [] };
  // @cpt-end:cpt-frontx-algo-ai-kit-packaging-manifest-validation:p1:inst-return-pass
}

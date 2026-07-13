export { validateKitManifest } from './validate-manifest.js';
export { loadKitSession, KitLifecycleState } from './session.js';
export { createFsResourceBodyReader } from './resource-body-reader.js';
export type {
  KitManifest,
  KitManifestMeta,
  KitResourceEntry,
  ValidationViolation,
  ValidationResult,
  KitRegistration,
  KitCapability,
  KitSessionResult,
  ResourceBodyReader,
} from './types.js';

// F16 Template AI-Extension Contract & Discovery/Activation
export { EXTENSION_CATEGORIES, AiExtensionLifecycleState } from './extensions/types.js';
export type {
  ExtensionCategory,
  AiExtensionEntry,
  AiExtensionBundle,
  StructuralError,
  LifecycleResult,
  CapabilityContribution,
  ComposedCapabilitySet,
  ScanAndActivateResult,
} from './extensions/types.js';
export { isExtensionCategory, validateExtensionEntry } from './extensions/contract.js';
export { scanAndComposeExtensions } from './extensions/scan.js';
export type { BaseCapabilities } from './extensions/scan.js';
export {
  transitionBundledToDiscovered,
  transitionFromDiscovered,
  transitionValidatedToActivated,
  runExtensionLifecycle,
} from './extensions/lifecycle.js';
export {
  validateBundleForPublish,
  discoverAndActivateForInstalledTemplate,
} from './extensions/discover-and-activate.js';
export type { PrePublishValidationResult } from './extensions/discover-and-activate.js';

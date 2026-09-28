/**
 * MFE Error Class Hierarchy
 *
 * Error classes for MFE system failures.
 * Extracted from the legacy screensets package in Phase 7 (extension-domain governance).
 *
 * @packageDocumentation
 */

export type { ContractError } from './ContractError';
export { MfeError } from './MfeError';
export { DomainValidationError } from './DomainValidationError';
export { MfeLoadError } from './MfeLoadError';
export { ExtensionTypeError } from './ExtensionTypeError';
export { ChainExecutionError } from './ChainExecutionError';
export { MfeTypeConformanceError } from './MfeTypeConformanceError';
export { UnsupportedDomainActionError } from './UnsupportedDomainActionError';
export { UnsupportedLifecycleStageError } from './UnsupportedLifecycleStageError';
export { ActionsChainRefusalError, type ActionsChainRefusalClass } from './ActionsChainRefusalError';
export { EntryTypeNotHandledError } from './EntryTypeNotHandledError';
export { DomainRouteValidationError } from './DomainRouteValidationError';
export { ExtensionRouteConflictError } from './ExtensionRouteConflictError';
export { DuplicateRouteTokenError } from './DuplicateRouteTokenError';

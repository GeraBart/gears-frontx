// @cpt-flow:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1
// @cpt-algo:cpt-frontx-algo-template-ai-extensions-contract-scan-activate:p1
//
// Live production entry point for the install-discover-activate leg
// (Kit-reads-project direction only, DESIGN §3.4 — never a CLI call): binds
// the EXISTING pure `discoverAndActivateFromInstalledTemplateFs` algorithm to
// a real filesystem `BundleFsReader` (`createFsBundleReader()`), so the AI
// Tooling Framework can scan a scaffolded project's real `.frontx/ai/`
// directory on disk. No scan/compose logic is duplicated here — this module
// is pure wiring (single-engine/DRY discipline).
import { createFsBundleReader } from './fs-bundle-reader.js';
import { discoverAndActivateFromInstalledTemplateFs } from './discover-and-activate.js';
import type { BaseCapabilities } from './scan.js';
import type { ScanAndActivateResult } from './types.js';

/**
 * Scans the scaffolded project rooted at `projectRoot` for every per-template
 * id-scoped AI-extension bundle under its real, on-disk `.frontx/ai/`
 * (`inst-initiate-discovery`), composing all discovered bundles with
 * `baseCapabilities` under installation-order precedence
 * (`inst-compose-under-precedence`, `inst-activate-capabilities`,
 * `inst-return-activated`). Exported from `src/index.ts`.
 */
// @cpt-begin:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-initiate-discovery
export function discoverAndActivateFromScaffoldedProject(
  projectRoot: string,
  baseCapabilities: BaseCapabilities,
  installOrder: number,
): ScanAndActivateResult {
  return discoverAndActivateFromInstalledTemplateFs(projectRoot, createFsBundleReader(), baseCapabilities, installOrder);
}
// @cpt-end:cpt-frontx-flow-template-ai-extensions-bundle-publish-discover-activate:p1:inst-initiate-discovery

/**
 * FrontX Dependency Cruiser Configuration (Ecosystem Root)
 *
 * Contains the dependency rules for the FrontX ecosystem packages (mfes,
 * gts-plugin, api, cli, cyber-pilot-kit-frontx).
 *
 * The non-Pillar-1 packages (state, i18n, framework, react, auth, studio)
 * and the host app now live in the self-contained top-level
 * `template-standard/` (Phase 11 template-move); its template-internal
 * layering/isolation rules moved into its own `.dependency-cruiser.cjs`.
 * Once template-standard is no longer an npm workspace of this repo,
 * ecosystem packages have no module-resolution path into it at all — the
 * forbid rules below enforce that boundary generically (by shape, not by
 * naming the template's path), so they keep working if the template's
 * location or identity changes.
 */

module.exports = {
  forbidden: [
    // ============ L0 BASE: UNIVERSAL RULES ============
    {
      name: 'no-circular',
      severity: 'error',
      from: { path: '^(?!.*node_modules)' },
      to: { circular: true },
      comment: 'Circular dependencies create tight coupling and make code harder to reason about.',
    },

    // ============ @gears-frontx/mfes BOUNDARY STUBS ============
    {
      name: 'mfes-no-type-format-literals',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-mfes-no-type-format-literals (MFES-1) — @gears-frontx/mfes must contain no type-system-format string literals.',
    },
    {
      name: 'mfes-no-solution-shared-properties',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-mfes-no-solution-shared-properties (MFES-2)',
    },
    {
      name: 'mfes-no-layout-domain-values',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-mfes-no-layout-domain-values (MFES-3)',
    },
    {
      name: 'mfes-no-type-format-dependency',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-mfes-no-type-format-dependency (MFES-4)',
    },
    {
      name: 'mfes-opaque-schema-surface',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-mfes-opaque-schema-surface (MFES-5)',
    },

    // ============ @gears-frontx/gts-plugin BOUNDARY STUBS ============
    {
      name: 'gts-plugin-owns-infra-schemas',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-gts-plugin-owns-infra-schemas (GTS-PLUGIN-1)',
    },
    {
      name: 'gts-plugin-excludes-solution-schemas',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-gts-plugin-excludes-solution-schemas (GTS-PLUGIN-2)',
    },

    // ============ @gears-frontx/api BOUNDARY STUB ============
    {
      name: 'api-no-solution-content',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-api-no-solution-content (API-1)',
    },

    // ============ @gears-frontx/cli BOUNDARY STUB ============
    {
      name: 'cli-template-independence',
      severity: 'warn',
      from: {},
      to: {},
      comment: 'STUB: cpt-frontx-constraint-cli-template-independence (CLI-1)',
    },

    // ============ PILLAR-1 BOUNDARY ENFORCEMENT (Phase 10) ============

    // @cpt-begin:cpt-frontx-constraint-mfes-no-type-format-dependency:p10:inst-dep-cruiser-rule
    {
      name: 'frontx-mfes-4-type-format-dep',
      severity: 'error',
      from: { path: '^packages/mfes/' },
      to: { path: '^packages/gts-plugin/|node_modules/@globaltypesystem/' },
      comment: 'cpt-frontx-constraint-mfes-no-type-format-dependency (MFES-4): @gears-frontx/mfes must declare no dependency on any concrete type-format implementation.',
    },
    // @cpt-end:cpt-frontx-constraint-mfes-no-type-format-dependency:p10:inst-dep-cruiser-rule

    // @cpt-begin:cpt-frontx-constraint-gts-plugin-owns-infra-schemas:p10:inst-dep-cruiser-rule
    {
      name: 'frontx-gts-plugin-1-infra-schemas',
      severity: 'error',
      from: { path: '^packages/', pathNot: '^packages/gts-plugin/' },
      to: { path: '^packages/gts-plugin/src/frontx\\.mfes/' },
      comment: 'cpt-frontx-constraint-gts-plugin-owns-infra-schemas (GTS-PLUGIN-1): Infrastructure schemas are owned exclusively by @gears-frontx/gts-plugin.',
    },
    // @cpt-end:cpt-frontx-constraint-gts-plugin-owns-infra-schemas:p10:inst-dep-cruiser-rule

    // @cpt-begin:cpt-frontx-constraint-gts-plugin-excludes-solution-schemas:p10:inst-dep-cruiser-rule
    {
      name: 'frontx-gts-plugin-2-no-solution-schemas',
      severity: 'error',
      from: { path: '^packages/gts-plugin/' },
      to: { path: '^(?!packages/|node_modules/|internal/|scripts/).+' },
      comment: 'cpt-frontx-constraint-gts-plugin-excludes-solution-schemas (GTS-PLUGIN-2): @gears-frontx/gts-plugin must not import solution-specific schemas.',
    },
    // @cpt-end:cpt-frontx-constraint-gts-plugin-excludes-solution-schemas:p10:inst-dep-cruiser-rule

    // @cpt-begin:cpt-frontx-constraint-api-no-solution-content:p10:inst-dep-cruiser-rule
    {
      name: 'frontx-api-1-no-solution-content',
      severity: 'error',
      from: { path: '^packages/api/src/', pathNot: '__tests__' },
      to: { path: '^(?!packages/|node_modules/|internal/|scripts/).+' },
      comment: 'cpt-frontx-constraint-api-no-solution-content (API-1): @gears-frontx/api production surface must contain no solution-specific content.',
    },
    // @cpt-end:cpt-frontx-constraint-api-no-solution-content:p10:inst-dep-cruiser-rule

    // ============ PILLAR-2 BOUNDARY ENFORCEMENT (Phase 17) ============

    // @cpt-begin:cpt-frontx-constraint-cli-template-independence:p17:inst-dep-cruiser-rule
    {
      name: 'frontx-cli-1-no-bundled-template-content',
      severity: 'error',
      from: { path: '^packages/cli/' },
      to: { path: '^(?!packages/|node_modules/|internal/|scripts/).+' },
      comment: 'cpt-frontx-constraint-cli-template-independence (CLI-1): @gears-frontx/cli must have zero dependency on bundled template content/assets/packages. Templates are resolved by source-spec at runtime.',
    },
    // @cpt-end:cpt-frontx-constraint-cli-template-independence:p17:inst-dep-cruiser-rule
  ],
  options: {
    doNotFollow: '^node_modules',
    exclude: {
      dynamic: true,
      path: 'packages/.*/dist|node_modules|packages/mfes/mfes',
    },
  },
};

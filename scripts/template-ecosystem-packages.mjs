/**
 * The FrontX ecosystem packages a template consumes as an exact-pinned
 * registry dependency (#485 / PR #492) - as opposed to `cli` or
 * `cyber-pilot-kit-frontx`, which a seeded project never installs.
 *
 * Single source for the two tools that both need this set: the in-monorepo
 * dev-link script (`link-template-ecosystem.mjs`, which repoints these
 * directories at local sources for the dev loop) and the pin-drift CI guard
 * (`template-pin-drift-check.mjs`, which checks every pinned site across the
 * template tree still matches these packages' actual published versions).
 * Declaring the set twice is exactly how the two tools could silently drift
 * apart from each other (#493) - one constant closes that gap.
 */
export const templatePinnedEcosystemPackageDirs = ['api', 'mfes', 'gts-plugin'];

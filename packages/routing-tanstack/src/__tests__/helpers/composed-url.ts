// Builds composed-application URLs through the routing package's own grammar
// serializer, so a fixture URL follows the URL grammar of the navigation
// substrate FEATURE (§1.5) rather than a hand-written string.
import { serializeGrammar, type Entry } from '@gears-frontx/routing';
import { entry } from './index.js';

/** The dashboard occupant's own entry: route `settings/general`, search `orientation=left`. */
export const DASHBOARD_ENTRY: Entry = entry('screen', 'dashboard', [
  { name: 'route', value: 'settings/general' },
  { name: 'orientation', value: 'left' },
]);

/** A sibling occupant's own entry, which a write by the dashboard must leave alone. */
export const SIDEBAR_ENTRY: Entry = entry('sidebar', 'nav', [{ name: 'route', value: 'x' }]);

export function composedUrl(shellSubroute: string, entries: readonly Entry[], hash?: string): string {
  return serializeGrammar({ shellSubroute, hash, entries });
}

// Shell-runtime virtual-location source: the shell's private subroute is the
// pathname (FEATURE (engine-provider) §3, Extension Router,
// `inst-er-private-subroute`), so the shell's router and `navigation()`
// read and change the pathname alone and leave the query string, which
// carries every extension's entry, untouched.
//
// FEATURE (engine-provider) §3, "History Adaptation To The RouterHistory
// Contract", steps 1 (projection), 2 (write-back), 4 (`createHref`), each in
// its shell-runtime case.
import { parseGrammar, serializeGrammar, type HistoryVerb, type NavigationHistory } from '@gears-frontx/routing';
import type { RouterHistory } from '@tanstack/react-router';
import { adaptVirtualLocationHistory, type AdaptHistoryOptions, type VirtualLocationSource } from './history-adaptation.js';
import { projectVirtualLocationToParams } from './virtual-location.js';

/**
 * Builds a `VirtualLocationSource` (`./history-adaptation.js`) over the
 * shell's subroute (the pathname): the virtual pathname is the page's
 * pathname, and the virtual search is always empty.
 */
// @cpt-algo:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2
export function createShellVirtualLocationSource(navigationHistory: NavigationHistory): VirtualLocationSource {
  return {
    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-project-virtual-location
    // The pathname as the virtual pathname, with an empty search: projected
    // through the same `route`-parameter pair every source is read through
    // (`projectParamsToVirtualLocation`), which round-trips the pathname
    // unchanged. Never `undefined`: the pathname is always present.
    readParams: () => projectVirtualLocationToParams(navigationHistory.location.path, ''),
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-project-virtual-location

    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-expose-direct-members
    // Writes the pathname alone: the current location is parsed by the
    // navigation substrate's own grammar codec and serialized again with
    // only its shell's subroute replaced, so the codec carries the query
    // string and the current page hash through unchanged
    // (`inst-expose-direct-members`). The virtual search is not part of the shell's subroute
    // and is not written.
    write: (pathname: string, _search: string, verb: HistoryVerb): void => {
      const { path, search, hash } = navigationHistory.location;
      navigationHistory[verb](serializeGrammar({ ...parseGrammar({ shellSubroute: path, search, hash }), shellSubroute: pathname }));
    },
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-expose-direct-members

    // @cpt-begin:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-create-href
    // The current URL with the pathname replaced and the query string
    // unchanged, composed by the grammar serializer. The current location
    // is parsed without its hash, so the returned href carries none.
    createHref: (pathname: string): string => {
      const { path, search } = navigationHistory.location;
      return serializeGrammar({ ...parseGrammar({ shellSubroute: path, search }), shellSubroute: pathname });
    },
    // @cpt-end:cpt-frontx-algo-routing-engine-provider-history-adaptation:p2:inst-derive-create-href
  };
}

/**
 * Convenience composition of `createShellVirtualLocationSource` and
 * `adaptVirtualLocationHistory` (`./history-adaptation.js`) — the shell
 * runtime's counterpart of `adaptComposedHistory`
 * (`./composed-history-source.js`). `options` is forwarded straight through.
 */
export function adaptShellHistory(navigationHistory: NavigationHistory, options?: AdaptHistoryOptions): RouterHistory {
  return adaptVirtualLocationHistory(navigationHistory, createShellVirtualLocationSource(navigationHistory), options);
}

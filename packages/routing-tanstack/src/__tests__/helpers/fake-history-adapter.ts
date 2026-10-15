// Test-only double for the browser's own session history, as the navigation
// substrate's `window` adapter reads and writes it.
//
// `@gears-frontx/routing` publishes no history seam: its public
// `resolveNavigationHistory()` takes no argument and builds the realm-shared
// `NavigationHistory` over `window.history`, `window.location` and the
// `popstate` event. This double is what `resetRealm` (`./index.ts`) installs
// behind those three, so a test seeds the page address and observes every
// write through the package's public entry alone, never through the sibling
// package's own `src/`.
//
// It keeps its own stack of entries and per-entry states, mirrors the
// current entry into the realm's real address (`mirrorAddress`, which writes
// jsdom's own `window.location`), and delivers a traversal to the `popstate`
// listeners registered with it from a microtask, as a browser delivers one
// after the move.

/** The `{path, search, hash}` triple one history entry carries. */
export interface AdapterLocation {
  readonly path: string;
  readonly search: string;
  readonly hash: string;
}

function splitPath(path: string): AdapterLocation {
  const hashIndex = path.indexOf('#');
  const withoutHash = hashIndex === -1 ? path : path.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : path.slice(hashIndex + 1);

  const searchIndex = withoutHash.indexOf('?');
  const pathname = searchIndex === -1 ? withoutHash : withoutHash.slice(0, searchIndex);
  const search = searchIndex === -1 ? '' : withoutHash.slice(searchIndex + 1);

  return { path: pathname, search, hash };
}

function joinPath(location: AdapterLocation): string {
  const search = location.search === '' ? '' : `?${location.search}`;
  const hash = location.hash === '' ? '' : `#${location.hash}`;
  return `${location.path}${search}${hash}`;
}

export class FakeHistoryAdapter {
  private entries: AdapterLocation[];
  // One opaque per-entry state per entry, as `window.history.state` keeps
  // one: the navigation substrate records its own position there and reads
  // it back on a traversal.
  private entryStates: unknown[];
  private index = 0;
  private popListeners = new Set<() => void>();

  /** The raw string argument the most recent `pushState`/`replaceState`
   * call received — the seam a test asserts the single write's exact URL
   * against, rather than reconstructing one from `getLocation()`. */
  lastWrite: string | undefined;

  constructor(
    initialPath = '/',
    private readonly mirrorAddress: (path: string) => void = () => {},
  ) {
    this.entries = [splitPath(initialPath)];
    this.entryStates = [undefined];
    this.mirrorCurrent();
  }

  getLocation(): AdapterLocation {
    return this.entries[this.index];
  }

  getState(): unknown {
    return this.entryStates[this.index];
  }

  pushState(path: string, state?: unknown): void {
    this.lastWrite = path;
    this.entries = this.entries.slice(0, this.index + 1);
    this.entryStates = this.entryStates.slice(0, this.index + 1);
    this.entries.push(splitPath(path));
    this.entryStates.push(state);
    this.index += 1;
    this.mirrorCurrent();
  }

  replaceState(path: string, state?: unknown): void {
    this.lastWrite = path;
    this.entries[this.index] = splitPath(path);
    this.entryStates[this.index] = state;
    this.mirrorCurrent();
  }

  go(delta: number): void {
    const nextIndex = this.index + delta;
    if (nextIndex < 0 || nextIndex >= this.entries.length) {
      return;
    }
    this.index = nextIndex;
    this.mirrorCurrent();
    this.firePopAsync();
  }

  onPop(listener: () => void): () => void {
    this.popListeners.add(listener);
    return () => {
      this.popListeners.delete(listener);
    };
  }

  /** Simulates a browser-observed navigation this adapter's own `go` did not
   * cause: a back/forward step, a third-party `history.go`, or a
   * fragment-only anchor activation. */
  simulateExternalPop(path: string): void {
    this.entries = this.entries.slice(0, this.index + 1);
    this.entryStates = this.entryStates.slice(0, this.index + 1);
    this.entries.push(splitPath(path));
    this.entryStates.push(undefined);
    this.index += 1;
    this.mirrorCurrent();
    this.firePopAsync();
  }

  private mirrorCurrent(): void {
    this.mirrorAddress(joinPath(this.entries[this.index]));
  }

  private firePopAsync(): void {
    queueMicrotask(() => {
      for (const listener of this.popListeners) {
        listener();
      }
    });
  }
}

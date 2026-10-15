# @gears-frontx/routing-tanstack

FrontX's default routing-engine provider: the published library that binds the navigation
substrate's shared browser history (`@gears-frontx/routing`) to TanStack Router. It gives each
runtime one router over that runtime's own private subroute — an extension's own entry in the
URL, or, in the shell runtime, the pathname — and nothing outside it.

The navigation substrate stays engine-agnostic by constraint; this package is the deliberately
concrete side of that boundary. It is the only package in the ecosystem that imports a concrete
router engine, so a microfrontend can adopt a different conforming provider without a change to
the substrate, the runtime, or a sibling microfrontend.

The requirements (PRD), the structure and constraints (DESIGN), and the behavior the
`engine-provider` FEATURE specifies live in this package's own `architecture/` tree in the FrontX
repository; they are not part of the published package.

## Public entry

- `ExtensionRouter({ routeTree })` — builds and renders the runtime's one router from the route
  tree the runtime provides.
- `navigation()` — `navigate(path)`, `replace(path)` and `location()` over the runtime's own private
  subroute, for code outside the rendered tree, such as an action handler.
- The engine's route-tree builders and scoped route hooks, re-exported unchanged:
  `createRootRoute`, `createRootRouteWithContext`, `createRoute`, `useNavigate`, `useParams`,
  `useSearch`, `useRouterState`, `Link`, `Outlet`, `redirect`, `notFound`.

History adaptation, router construction and the provider component are internal to this package.

```tsx
import { createRootRoute, createRoute, ExtensionRouter, Outlet } from '@gears-frontx/routing-tanstack';

const root = createRootRoute({ component: Outlet });
const routeTree = root.addChildren([
  createRoute({ getParentRoute: () => root, path: '/settings/general', component: GeneralSettings }),
]);

export function Content() {
  return <ExtensionRouter routeTree={routeTree} />;
}
```

## The runtime's own private subroute

`ExtensionRouter` and `navigation()` work over the runtime's own private subroute and nothing else:

- **In an extension's runtime**, the router's pathname is the extension's own route (`/` when it
  has none) and its search is the extension's own parameters. With the extension at route
  `settings/general` and parameter `orientation=left`, the router sees pathname
  `/settings/general` and search `orientation=left`. Every navigation it performs changes that
  private subroute alone.
- **In the shell runtime**, the router works over the pathname, with an empty search. A navigation
  changes the pathname alone.
- **In an extension runtime with no private subroute** — an extension with no route of its own or
  of its domain — `ExtensionRouter` and `navigation()` refuse with an error.

The page hash belongs to no runtime: a hash passed to a navigation or a link is dropped, a write
keeps the current page hash unchanged, and an href this package builds carries no hash.

## Subscription lifetime

`ExtensionRouter` builds its history once per mount and its router again only when the route tree
changes. The history observes the shared navigation history only while the router is mounted: the
subscription is established at mount and released at unmount, and the two are exact inverses, so a
component that mounts and unmounts repeatedly (including React's development-mode double-mount) ends
up with exactly one live subscription while it is mounted and none once it is gone.

`navigation()` builds a fresh history at each member's own call, reads the current location at that
call, and never subscribes.

## Router construction options

`ExtensionRouter` supplies no construction option beyond the route tree and the history, so the
router it builds carries no router context.

## What an entry cannot carry

The navigation substrate's history contract has no place for per-entry state: `push` and `replace`
take a path, and the substrate owns the browser's own per-entry state exclusively, for bookkeeping
of its own that it rewrites on every write. This provider therefore accepts the state argument the
engine's history contract passes and drops it, rather than keeping a copy in memory that the first
reload would empty and the first back step would bypass.

What that means in a microfrontend using this provider:

- `useLocation().state` never carries a value you put there, and neither does anything reading state
  off a location — `navigate({ state })` and `<Link state={...}>` included.
- Route masking does not work, because the engine implements it on top of that same per-entry state.

Carry what you would have put in state in the router's own search instead, where it survives a
reload and a shared link. A microfrontend that genuinely needs entry-carried state needs a different
engine-provider port implementation, over an engine whose own history contract provides it.

## License

Apache-2.0. `LICENSE` and `NOTICE` ship inside the package.

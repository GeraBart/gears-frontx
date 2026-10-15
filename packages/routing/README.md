# @gears-frontx/routing

FrontX's navigation library. It holds the FrontX router — one ready `router` instance per runtime,
which a runtime receives when its MFE registry is built (the registry config's `router` field) —
together with the router's two abstract dependencies, `ActionsChainExecutor` and
`RouterTypeSystem`, published as runtime abstract classes. It also holds one browser navigation
history and one URL grammar shared by a composed application and every independently bundled
microfrontend it contains, plus a signal naming which extension(s) own a given extension domain's
entries. Framework-agnostic and engine-agnostic by constraint — no dependency on any concrete
router engine or UI framework; a separately published engine-provider package binds this substrate
to one.

Every extension domain, at any depth, is addressed through the same entry grammar. The model task
(ADR-0003 example 7.1) reads in the address bar as one line:

```
/en?screen=dashboard;orientation=left&sheet=tenant-details;tenantId=456
   &sheet=user-contacts;contactId=123;view=active&widgets=line-a;range=7d
   &widgets=line-b;range=30d&widgets=pie;metric=revenue
```

The requirements (PRD), the structure and constraints (DESIGN), the decisions behind the grammar
(ADR), and the behavior each FEATURE specifies live in this package's own `architecture/` tree in
the FrontX repository; they are not part of the published package.

## Published surface

- `router` — the ready FrontX router instance, one per runtime.
- `ActionsChainExecutor`, `RouterTypeSystem` — the router's two abstract dependencies, runtime
  abstract classes.
- `resolveNavigationHistory` — the realm-shared navigation history (`location`, `subscribe`,
  `push`, `replace`, `go`).
- `parseGrammar`, `serializeGrammar`, `namesEqual` — the URL grammar codec and the name-equality
  predicate.
- `createRouteSignal(history)` — returns the URL back-projection helper and the observer factory,
  both bound to the one history it is given. The observer reads only the entries carrying one
  domain key and matches each entry's extension token against the list of extension tokens you
  pass in for that domain; nothing is read from any other package's manifest, registry, or
  configuration.

A domain key and an extension token must satisfy this package's lexical rule: lowercase letters,
digits, and hyphens, always starting with a letter. The rule is validated where a value is
declared, and a bad value is rejected immediately.

## License

Apache-2.0. `LICENSE` and `NOTICE` ship inside the package.

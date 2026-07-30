
# @gears-frontx/telemetry Guidelines (Canonical)

## AI WORKFLOW (REQUIRED)
1) Summarize 3-6 rules from this file before making changes.
2) STOP if you are about to add telemetry or tracking code anywhere outside this package.
3) STOP if you are about to import `@gears-frontx/*` or React from `src/**` outside `src/plugin/**`.

## SCOPE
- Package: `packages/telemetry/` (version 0.1.0, Apache-2.0)
- Gear: an L1-pure core plus an L2 framework adapter in one package.
- Runtime dependency: `bowser`, used only in `src/plugins/device.ts` (OS, browser, platform type).
  Everything else in that file is native DOM.
- Optional peer dependency: `@gears-frontx/framework`, used only by the `./plugin` entry.
- Entries: `.` -> `src/index.ts`, `./plugin` -> `src/plugin/index.ts`.

## LAYER MODEL (PATH-SCOPED, NOT PACKAGE-SCOPED)
- `packages/telemetry/src/**` except `src/plugin/**` -> L1-pure: ZERO `@gears-frontx`
  dependencies, no React.
- `packages/telemetry/src/plugin/**` -> may import `@gears-frontx/framework`, still no React and
  no `@gears-frontx/react`.
- Enforced by `internal/depcruise-config/gear.cjs`, which matches on path prefix.

```typescript
// GOOD: framework only reaches into the adapter
// src/plugin/index.ts
import { eventBus } from '@gears-frontx/framework';

// BAD: core file reaching for the framework
// src/services/telemetry.ts
import { eventBus } from '@gears-frontx/framework'; // GEAR VIOLATION
```

## PUBLIC SURFACE
- `.` values: `createTelemetry`, `telemetryElementHookKey`, `telemetryLocalePlugin`.
- `.` types: `TelemetryService`, `TelemetryLogEvent`, `TelemetryElementHook`,
  `TelemetryElementHookAttribution`, `TelemetryElementHookResult`, `LocaleSource`,
  `TelemetryEventRecord`, `TelemetryLogEventParams`, `TelemetryData`, `TelemetryConfig`.
- `./plugin`: `telemetry`, `getTelemetry`, type `TelemetryPluginConfig`.
- REQUIRED: anything new that consumers need goes through `src/index.ts`. Deep imports into
  `@gears-frontx/telemetry/src/**` are already blocked everywhere: an ESLint error inside
  `packages/**`, and the `no-internal-package-imports` dependency-cruiser rule from app `src/**`.

## CRITICAL RULES
- New collected data arrives as a plugin with an `event` hook, never as an edit to
  `createTelemetry` or `managers/events.ts`.
- Live hook keys are `start`, `event`, `destroy`. `sessionStart` is declared in
  `src/utils/hooks.ts` but nothing fires it. Do not build on it without wiring the call site.
- `pluginsManager.setup()` runs once, inside `start()`. A plugin registered after `start()` is
  stored but never set up.
- Plugins are keyed by `name` in a Map: a duplicate name silently replaces the earlier plugin.
- Plugins read `context.config` (normalized by `normalizeOptions`), never the caller's raw config.
- Set `url` explicitly at every call site. The default is the same-origin `/api/events`, and a
  failed POST is swallowed by `fetch(...).catch(console.error)`.
- `start`, `plugin` and `destroy` no-op when `typeof window === 'undefined'`. Keep that guard.
- Factory closures, not classes: `createTelemetry` and every `create*` manager return an object of
  inner functions.

```typescript
// GOOD: enrich records through a plugin's event hook
telemetry.plugin({
  name: 'tenant',
  setup: (context) => {
    context.addHook('event', (record) => {
      record.context_tenant_id = tenantId;
    });
  },
});

// BAD: new field written into the record inside managers/events.ts
```

## FRAMEWORK ADAPTER (`./plugin`)
```typescript
// GOOD: mount the gear as a framework plugin
import { telemetry } from '@gears-frontx/telemetry/plugin';

createHAI3()
  .use(telemetry({
    appName: 'cloud',
    appVersion: '1.4.2',
    url: 'https://telemetry.example.com/api/events',
    forwardEvents: ['user/loggedIn'],
  }))
  .build();
```
- `onInit` -> `createTelemetry(config).start()`; `onDestroy` -> unsubscribe, then `destroy()`.
- `forwardEvents` must name every bus key: the event bus has no wildcard subscription.
- `getTelemetry()` returns the live client for `logEvent` calls outside the bus. It is `undefined`
  before the app is built and after it is destroyed.

## ELEMENT HOOK CONTRACT
- Registry symbol: `Symbol.for('@gears-frontx/telemetry/element-hook')`. The global `Element`
  interface is augmented in `src/plugins/autocapture/elementHook.ts`.
- The symbol string is a cross-package, cross-deployment contract: reader (autocapture) and writer
  (whatever registers a hook) can be on different builds at the same time.
- REQUIRED: evolve additively. A semantic change to an existing field, or to the suppression or
  merge behavior, needs a NEW symbol string.
- FORBIDDEN: redefining what an existing symbol means.
- Settable fields are the allowlist in `telemetryElementHookAttributionKeys`:
  `context_service_name`, `context_service_version`, `context_call_chain`. Anything else a hook
  returns is dropped before merge.
- `capture: false` from ANY ancestor hook suppresses the whole event.
- The closest hook with a usable contribution wins its entire field set. `context` from one hook is
  never mixed with `data` from another.
- Hook `data` merges underneath autocapture's own keys. The `$` prefix is reserved: `$`-prefixed
  keys are stripped from a hook's `data`.
- `context_call_chain` must be the registering element's complete chain. The SDK never stitches
  chains across hooks.
- Before widening the allowlist, check which built-in plugin overwrites that field: `device.ts`
  and `appInfo.ts` clobber theirs unconditionally, so a hook value would be a silent no-op.

## LINT AND EXEMPTIONS
- Inline `eslint-disable` comments do NOTHING here. `linterOptions.noInlineConfig: true` is set for
  `**/*.{ts,tsx}` in the standalone config the root spreads. Every exemption goes in the root
  `eslint.config.js`.
- This package is exempt from the repo-wide lodash preference and from the no-`unknown` rule. Both
  live as selectors inside one `no-restricted-syntax` rule, which the gear block for
  `packages/telemetry/**/*.ts` switches off, same as the SDK block does for the L1 packages.
- Reason a reader cannot get from the code: this is a zero-dependency browser SDK shipped to
  consumer bundles, so it cannot pull lodash in, and its plugin, hook and DOM boundaries take
  untrusted consumer values that are `unknown` by design.
- The path-scoped import bans are two blocks: `packages/telemetry/**/*.ts` forbids all
  `@gears-frontx/*`, then `packages/telemetry/src/plugin/**/*.ts` narrows it to allow the
  framework. Keep both in sync with `internal/depcruise-config/gear.cjs`.
- `packages/telemetry/eslint.config.js` mirrors these exemptions for a package-local run. Flat
  config does not cascade, so `npm run lint:gears` from the repo root reads the ROOT config only -
  keep the two from drifting.

## NEVER HAND-ROLL TELEMETRY
- GUIDELINES.md BLOCKLIST bans telemetry and tracking code in app code. This package is the only
  sanctioned path.
- FORBIDDEN: a local `analytics.ts`, a bare `fetch` to an events endpoint, or a per-screenset
  event batcher.
- REQUIRED: `@gears-frontx/telemetry` for the SDK, `@gears-frontx/telemetry/plugin` inside a HAI3
  app, an element hook for per-subtree attribution.

## COMMANDS
- Package manager is npm workspaces, NOT pnpm. Node >=22.
```sh
npm run build --workspace=@gears-frontx/telemetry       # tsup: cjs + esm + dts, both entries
npm run test --workspace=@gears-frontx/telemetry        # vitest, happy-dom environment
npm run type-check --workspace=@gears-frontx/telemetry
npm run lint:gears                                      # eslint packages/telemetry/src
npm run arch:deps:gears                                 # path-scoped layer check
```
- Tests live beside the code as `src/**/*.test.ts` (`services/telemetry.test.ts`,
  `plugins/autocapture/autocapture.test.ts`).

## STOP CONDITIONS
- Importing `@gears-frontx/*` or React from `src/**` outside `src/plugin/**`.
- Adding a runtime dependency. `bowser` is the only one.
- Changing the element-hook symbol string, or what an existing hook field means.
- Adding an inline `eslint-disable` instead of a root `eslint.config.js` entry.
- Writing telemetry or tracking code outside this package.

## PRE-DIFF CHECKLIST
- [ ] `src/**` outside `src/plugin/**` imports zero `@gears-frontx` packages and no React.
- [ ] New collection added as a plugin with an `event` hook, not inside `createTelemetry`.
- [ ] Element-hook contract change is additive; symbol string untouched.
- [ ] No inline `eslint-disable`; any exemption is in the root `eslint.config.js`.
- [ ] Tests added beside the code as `src/**/*.test.ts` and passing.
- [ ] `npm run lint:gears` and `npm run arch:deps:gears` pass.

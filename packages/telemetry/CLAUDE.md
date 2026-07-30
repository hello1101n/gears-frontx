# @gears-frontx/telemetry

Browser telemetry SDK. Batches app events and POSTs them to an endpoint the consumer controls -
session tracking, device and navigation context, DOM autocapture, plugin system.

## SDK Layer

Layer rules here are **path-scoped, not package-scoped**:

| Path                            | Layer               | May import                                        |
| ------------------------------- | ------------------- | ------------------------------------------------- |
| `src/**` except `src/plugin/**` | SDK (L1), pure      | no `@gears-frontx/*`, no React                    |
| `src/plugin/**`                 | Framework adapter   | `@gears-frontx/framework` (optional peer dep)     |

Only runtime dependency: `bowser`, used solely in `src/plugins/device.ts` for OS name/version,
browser name/version and platform type. Everything else in that file is native DOM.

Two directories one letter apart, different meaning:

- `src/plugins/` - telemetry SDK plugins (`{ name, setup }`), L1-pure.
- `src/plugin/` - the HAI3 framework adapter, the only place framework imports are allowed.

## Core Concepts

### createTelemetry

```typescript
import { createTelemetry, telemetryLocalePlugin } from '@gears-frontx/telemetry';
import i18next from 'i18next';

const telemetry = createTelemetry({
  appName: 'cloud',
  appVersion: '1.4.2',
  url: 'https://telemetry.example.com/api/events',
})
  .plugin(telemetryLocalePlugin(i18next))
  .start();

telemetry.identify(user.id);
telemetry.logEvent('settings_saved', { theme: 'dark' });
```

`plugin`, `start` and `identify` return the service; `logEvent` and `destroy` return `void`.
`plugin()` drops falsy entries, so `flag && myPlugin()` is safe.

Flow: `logEvent` -> `event` hooks mutate the record -> queue -> flush -> POST

The flush timer is a 5s trailing debounce, re-armed by every event, so a steady event stream keeps
postponing the send. `visibilitychange` to `hidden` forces a flush.

`start()`, `plugin()` and `destroy()` no-op when `window` is undefined. `logEvent()` does not.

### Framework plugin entry

```typescript
import { createHAI3 } from '@gears-frontx/framework';
import { telemetry } from '@gears-frontx/telemetry/plugin';

createHAI3().use(telemetry({ appName: 'cloud', appVersion: '1.4.2' })).build();
```

The plugin owns the lifecycle: `onInit` -> `createTelemetry(...).start()`, `onDestroy` ->
`destroy()`. Its config can forward named `eventBus` events to `logEvent`. This entry is the only
reason `@gears-frontx/framework` is a peer dependency; plain SDK consumers never load it.

### Telemetry plugins

A plugin is `{ name, setup }`. `setup` receives the normalized config, `logEvent`, session
accessors, a logger, and `addHook`:

```typescript
telemetry.plugin({
  name: 'tenant',
  setup: (context) => {
    context.addHook('event', (record) => {
      record.context_tenant_id = tenantId;
    });
  },
});
```

Hook keys: `event` (every record, before it is queued), `start`, `destroy`. `sessionStart` is
declared in the hooks map but nothing calls it.

`setup()` runs once, inside `start()`. A plugin registered after `start()` is stored and never set
up. Plugins are keyed by `name`, and `start()` registers the built-ins (`session`, `device`,
`navigation`, `appInfo`, `autocapture`) after the caller's, so a custom plugin under one of those
names is silently replaced.

Hooks fire in registration order, which puts custom `event` hooks ahead of the built-ins: `device`
and `appInfo` overwrite the fields they own no matter what ran earlier. `context_language` is the
one field `device` fills only when unset - that is what makes `telemetryLocalePlugin` work.

### Element hooks

Any DOM element can register a hook that governs how autocapture treats events from its subtree:

```typescript
import { telemetryElementHookKey } from '@gears-frontx/telemetry';

el[telemetryElementHookKey] = () => ({
  context: { context_service_name: 'settings-panel', context_call_chain: ['settings-panel'] },
  data: { section: 'appearance' },
});
```

The key is `Symbol.for('@gears-frontx/telemetry/element-hook')`, and the property augments the
global `Element` interface. A registry symbol rather than a module-level `Symbol()`: several copies
of the SDK can be loaded on one page, and a per-module identity would break the handshake between
autocapture and the registered hook.

Autocapture walks the clicked element's ancestors, closest first, invoking every hook it finds:

- `capture: false` from ANY hook on the path drops the whole event.
- Contributions are atomic per element: the closest hook returning something usable wins its whole
  `context` + `data` set. A `context` from one hook is never mixed with `data` from another.
- `data` merges *under* autocapture's own keys; `$`-prefixed keys in a hook's `data` are stripped.
- Only `context_service_name`, `context_service_version` and `context_call_chain` are read from a
  hook's `context`; an allowlist drops every other key before the merge. Widening it buys nothing
  for a field `device` or `appInfo` overwrites unconditionally.
- `context_call_chain` must be the registering element's COMPLETE chain - chains are never stitched
  across hooks.
- A throwing hook degrades that element to no contribution; the first thrown value is re-thrown
  after the event is emitted, so it still reaches `window.onerror` with a real stack.

**Evolution rule.** Reader (autocapture) and writers (whatever sets a hook) ship separately and run
at mixed versions on the same page. Evolve additively only. Changing what an existing field, the
suppression rule, or the merge rule MEANS requires a NEW registry-symbol string - never a new
meaning under `@gears-frontx/telemetry/element-hook`.

### PII redaction is a safety net

Autocapture skips `password` and `hidden` inputs, skips elements whose `name` or `id` matches a
sensitive-name regex (`cvv`, `ssn`, `cardnum`, `pwd`, `routing`, ...), keeps only `name` / `id` /
`aria-label` on input-like elements, and drops values matching credit-card or US-SSN patterns.

That is pattern matching, not a compliance guarantee. Anything the patterns do not recognize -
tokens, emails, free text inside a `label`, custom attributes on a non-input element - is captured.
Audit the markup, and suppress explicitly on any subtree that renders personal data.

Explicit opt-out: `data-telemetry-no-capture="false"`. The value is compared literally, so a bare
attribute or `="true"` does nothing.

## Key Rules

1. **Register plugins before `start()`** - `setup()` runs only inside `start()`
2. **Layers are path-scoped** - only `src/plugin/**` may see `@gears-frontx/framework`
3. **Hook contributions are per-element and atomic** - never split one element's attribution
4. **Element hook contract is additive only** - semantic change means a new registry symbol
5. **Redaction is best-effort** - opt sensitive subtrees out explicitly

## Critical Rules

- REQUIRED: keep everything under `src/**` outside `src/plugin/**` free of `@gears-frontx` imports
  and React.
- REQUIRED: reach the framework only through the `@gears-frontx/telemetry/plugin` entry.
- REQUIRED: set `url` explicitly - it defaults to the same-origin path `/api/events`.
- REQUIRED: set `context_call_chain` whenever an element hook sets `context_service_name`;
  `appInfo` warns when the resulting chain does not contain the service name.
- FORBIDDEN: `$`-prefixed keys in an element hook's `data` - reserved for autocapture.
- FORBIDDEN: redefining an existing element-hook field under the current symbol.
- FORBIDDEN: naming a custom plugin `session`, `device`, `navigation`, `appInfo` or `autocapture`.
- FORBIDDEN: assuming `enabled: false` stops collection - hooks still run and the queue is still
  drained; only the POST is skipped.

## Development

npm workspaces, not pnpm. Node >=22.

```sh
npm run build      --workspace=@gears-frontx/telemetry   # tsup: cjs + esm + dts
npm run test       --workspace=@gears-frontx/telemetry   # vitest, happy-dom
npm run type-check --workspace=@gears-frontx/telemetry
```

Tests sit beside the code as `src/**/*.test.ts`.

## Exports

### `@gears-frontx/telemetry`

- `createTelemetry` - build the service: `plugin` / `start` / `logEvent` / `identify` / `destroy`
- `telemetryElementHookKey` - registry symbol an element registers its hook under
- `telemetryLocalePlugin` - fills `context_language` from a `LocaleSource`, normalized to BCP 47

Types: `TelemetryService`, `TelemetryLogEvent`, `TelemetryElementHook`,
`TelemetryElementHookAttribution`, `TelemetryElementHookResult`, `LocaleSource`,
`TelemetryEventRecord`, `TelemetryLogEventParams`, `TelemetryData`, `TelemetryConfig`

### `@gears-frontx/telemetry/plugin`

- `telemetry(config)` - HAI3 plugin, for `createHAI3().use(...)`
- `getTelemetry()` - the live client, `undefined` before the app is built and after it is destroyed

Type: `TelemetryPluginConfig` - `TelemetryConfig` plus `forwardEvents?: string[]`

# @gears-frontx/telemetry

Browser telemetry SDK. Batches application events and sends them to an endpoint you control.
Session tracking, device and navigation context, DOM autocapture, and a plugin system for
everything else.

SDK layer (L1): everything under `src/` has zero @gears-frontx dependencies and no React. Only
`src/plugin/`, behind the `./plugin` entry, imports `@gears-frontx/framework`.

## Install

Workspace package of this monorepo. npm workspaces resolves `@gears-frontx/telemetry` for packages
inside the repo, so there is nothing to install.

Built as CJS + ESM with type declarations. Requires a browser environment (`window`, `document`,
`localStorage`, `fetch`).

## Usage

```ts
import { createTelemetry } from '@gears-frontx/telemetry';

const telemetry = createTelemetry({
  appName: 'my-app',
  appVersion: '1.4.2',
  url: 'https://telemetry.example.com/api/events',
});

telemetry.identify(user.id);
telemetry.start();

telemetry.logEvent('settings_saved', { theme: 'dark' });
```

Out of the box the client captures sessions, device and client info, page navigation, and user
interactions. Events are batched and flushed on a timer.

Call `destroy()` on teardown to remove listeners and stop the scheduler.

## Configuration

`createTelemetry(config: TelemetryConfig)`

| Option            | Type      | Default    | Description                                                                                                        |
| ----------------- | --------- | ---------- | ------------------------------------------------------------------------------------------------------------------ |
| `appName`         | `string`  | *required* | Sent as `context_source_app_name`, and the default for `context_app_name` and `context_service_name`.               |
| `appVersion`      | `string`  | *required* | Application version, sent as `context_source_app_version` and mirrored into `context_app_version`.                   |
| `url`             | `string`  | see below  | Endpoint events are POSTed to. Defaults to the same-origin path `/api/events` when `apiVersion` is `1`, otherwise `/api/telemetry/v{apiVersion}/events`. |
| `autocapture`     | `boolean` | `true`     | Automatically capture `click`, `change` and `submit` events from the page.                                           |
| `enabled`         | `boolean` | `true`     | When `false`, events are still collected, enriched and drained from the queue — only the POST is skipped.            |
| `verbose`         | `boolean` | `false`    | Log SDK activity to the console.                                                                                     |
| `storagePrefix`   | `string`  | —          | Infix for the `localStorage` keys the SDK owns (device id, session).                                                 |
| `sessionDuration` | `number`  | `1800000`  | Inactivity window in milliseconds before a new session id is minted. Defaults to 30 minutes.                         |
| `apiVersion`      | `number`  | `1`        | Event envelope version.                                                                                              |

> **`url` currently defaults to the same-origin path `/api/events`, and send failures are swallowed.**
> Always set it explicitly until that default is removed — see *Known gaps* below.

## API

`createTelemetry()` returns a `TelemetryService`:

| Method                 | Returns          | Description                                                                          |
| ---------------------- | ---------------- | ------------------------------------------------------------------------------------ |
| `start()`              | `TelemetryService`| Begin collecting. Installs listeners and starts the flush scheduler.                  |
| `identify(id)`         | `TelemetryService`| Attach a user id to subsequent events. `string \| number`.                            |
| `logEvent(name, data?)`| `void`           | Record a custom event. Also accepts a full record: `logEvent({ name, data, ... })`.    |
| `plugin(...plugins)`   | `TelemetryService`| Register plugins. Falsy entries are ignored, so `cond && myPlugin()` is safe.          |
| `destroy()`            | `void`           | Remove listeners, stop the scheduler, and stop collecting.                             |

All methods except `logEvent` and `destroy` are chainable.

## HAI3 plugin

The `./plugin` subpath exposes the SDK as a framework plugin, so an app does not manage the
lifecycle itself:

```ts
import { createHAI3 } from '@gears-frontx/framework';
import { telemetry } from '@gears-frontx/telemetry/plugin';

const app = createHAI3()
  .use(telemetry({
    appName: 'my-app',
    appVersion: '1.4.2',
    url: 'https://telemetry.example.com/api/events',
  }))
  .build();
```

`onInit` -> `createTelemetry(config).start()`, `onDestroy` -> unsubscribe, then `destroy()`. The
config takes the same `TelemetryConfig` options as `createTelemetry`, plus `forwardEvents` — the
`eventBus` keys to forward to `logEvent`, which keeps app events out of the call sites that emit
them. The bus has no wildcard subscription, so every forwarded key has to be named.

The same entry exports `getTelemetry()`, which returns the live client for `logEvent` calls outside
the bus. It is `undefined` before the app is built and after it is destroyed.

`@gears-frontx/framework` is an optional peer dependency needed by this entry only. Importing
`@gears-frontx/telemetry` never pulls it in.

## Locale plugin

Injects the current locale into every event record, normalized to BCP 47.

```ts
import { createTelemetry, telemetryLocalePlugin } from '@gears-frontx/telemetry';
import i18next from 'i18next';

createTelemetry({ appName: 'my-app', appVersion: '1.4.2' })
  .plugin(telemetryLocalePlugin(i18next))
  .start();
```

The plugin takes any `LocaleSource` — an object with a `language: string` property, read fresh on
every event. An `i18next` instance satisfies it directly; anything else needs a one-line adapter:

```ts
telemetryLocalePlugin({ get language() { return intl.locale; } });
```

## Writing a plugin

A plugin is `{ name, setup }`. `setup` receives a context with the normalized config, a `logEvent`,
session accessors, a logger, and `addHook`:

```ts
telemetry.plugin({
  name: 'tenant',
  setup: (context) => {
    context.addHook('event', (record) => {
      record.context_tenant_id = tenantId;
    });
  },
});
```

`context` and `record` are typed contextually, so there is nothing to import.

The `event` hook runs on every record before it is queued, so it can enrich or overwrite fields.
`plugin()` ignores falsy arguments, so `cond && myPlugin()` is safe, and it is chainable.

## Autocapture

When `autocapture` is on, the SDK listens for `click`, `change` and `submit` on `document` (capture
phase, passive) and records the element's tag name, text, and a safe subset of its attributes.

### Opting out

Add `data-telemetry-no-capture="false"` to an element to suppress capture for its subtree.

> The value is inverted from what the name suggests — a bare attribute or `="true"` does nothing.
> See *Known gaps*.

### Element hooks

Any element can register a hook that governs how autocapture treats events from its subtree:

```ts
import { telemetryElementHookKey } from '@gears-frontx/telemetry';

el[telemetryElementHookKey] = () => ({
  context: {
    context_service_name: 'settings-panel',
    context_service_version: '1.0.0',
    context_call_chain: ['settings-panel'],
  },
  data: { section: 'appearance' },
});
```

The key is a `Symbol.for` registry symbol, so hooks work across multiple copies of the SDK loaded
on the same page. On each captured event, autocapture walks from the clicked element up through its
ancestors and invokes every hook it finds:

- returning `{ capture: false }` from **any** ancestor hook suppresses the whole event;
- the closest hook returning a contribution wins its entire field set — `context` and `data` are
  never mixed across hooks;
- `data` merges *underneath* autocapture's own keys, which always win. Keys starting with `$` are
  reserved for the SDK;
- a hook that throws does not drop the event; that element degrades to no contribution and the
  error is rethrown after the event is emitted, so it reaches `window.onerror`.

Only `context_service_name`, `context_service_version` and `context_call_chain` may be set through
a hook — other record fields are overwritten by built-in plugins before send.

Set `context_call_chain` whenever you set `context_service_name`: the built-in `appInfo` plugin
prepends the app name and warns if the resulting chain does not contain the service. The value must
be the registering element's complete chain below the app — the SDK never stitches chains together
across hooks.

## PII

Autocapture applies redaction before recording element values: it skips `password` and `hidden`
inputs, skips fields whose `name` or `id` looks sensitive (`cvv`, `ssn`, `cardnum`, `pwd`,
`routing`, …), and drops values matching credit-card or US-SSN patterns. This is a safety net, **not** a
compliance guarantee. Audit what your own markup exposes, and use the opt-out attribute or an
element hook on any subtree that renders personal data.

## Browser support

Modern evergreen browsers. Requires `fetch`, `localStorage`, `crypto.randomUUID` and `Intl.Locale`.
No polyfills are bundled.

## Known gaps

The SDK is being extracted from an internal codebase. These are tracked and will change:

- `url` defaults to same-origin `/api/events`, and a failed send is swallowed — set `url` explicitly.
- The request body currently uses a Kafka REST Proxy envelope and stringifies each field, so
  `data: { a: 'b' }` arrives as `data: { a: '"b"' }`. A pluggable transport will replace it.
- `Content-Type` is not configurable.
- `data-telemetry-no-capture` is inverted, as noted above.
- Several `context_*` record fields are declared but never populated.

## Development

Node >=22, npm workspaces.

```sh
npm run build --workspace=@gears-frontx/telemetry       # tsup: cjs + esm + dts
npm run test --workspace=@gears-frontx/telemetry        # vitest, happy-dom
npm run type-check --workspace=@gears-frontx/telemetry
```

Tests sit beside the code they cover, as `src/**/*.test.ts`.

## License

Apache-2.0

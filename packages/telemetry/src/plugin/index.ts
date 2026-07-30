import { eventBus } from '@gears-frontx/framework';
import type { EventPayloadMap, HAI3Plugin, Subscription } from '@gears-frontx/framework';
import { createTelemetry } from '../index';
import type { TelemetryConfig, TelemetryData, TelemetryService } from '../index';

export type TelemetryPluginConfig = TelemetryConfig & {
  /**
   * Event bus keys forwarded to `logEvent`. The bus has no wildcard subscription, so every
   * forwarded event has to be named.
   */
  forwardEvents?: string[];
};

let instance: TelemetryService | undefined;
let subscriptions: Subscription[] = [];

/**
 * The live client, for callers that need `logEvent` outside the event bus. Undefined before the
 * app is built and after it is destroyed.
 */
export function getTelemetry(): TelemetryService | undefined {
  return instance;
}

export function telemetry(config: TelemetryPluginConfig): HAI3Plugin {
  const { forwardEvents = [], ...telemetryConfig } = config;

  return {
    name: 'telemetry',

    onInit() {
      instance = createTelemetry(telemetryConfig).start();
      subscriptions = forwardEvents.map(forward);
    },

    onDestroy() {
      subscriptions.forEach((subscription) => subscription.unsubscribe());
      subscriptions = [];
      instance?.destroy();
      instance = undefined;
    },
  };
}

function forward(name: string): Subscription {
  // EventPayloadMap is empty until a consumer augments it in their own compilation, so this
  // package cannot name the keys it forwards. The bus is keyed by string at runtime.
  const key = name as keyof EventPayloadMap;

  return eventBus.on(key, (payload) => {
    instance?.logEvent(name, toEventData(payload));
  });
}

function toEventData(payload: unknown): TelemetryData | undefined {
  if (payload === undefined || payload === null) {
    return undefined;
  }

  if (typeof payload !== 'object' || Array.isArray(payload)) {
    return { payload };
  }

  return { ...payload };
}

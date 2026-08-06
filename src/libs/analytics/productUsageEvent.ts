import type { AnalyticsEvent, AnalyticsManager } from '@lobehub/analytics';
import { getSingletonAnalyticsOptional } from '@lobehub/analytics';

import {
  type ProductTelemetryEvent,
  submitProductTelemetryEvent,
} from '@/services/productTelemetry';
import { getUserStoreState } from '@/store/user';
import { userGeneralSettingsSelectors } from '@/store/user/selectors';

import { resolveTelemetryEnabled } from '../telemetry/mode';

interface TrackProductUsageEventOptions {
  analytics?: AnalyticsManager | null;
}

export const isProductUsageEventEnabled = () =>
  resolveTelemetryEnabled(userGeneralSettingsSelectors.telemetry(getUserStoreState()));

export const trackProductUsageEvent = async (
  event: AnalyticsEvent,
  options: TrackProductUsageEventOptions = {},
) => {
  if (!isProductUsageEventEnabled()) return false;

  const persisted = await submitProductTelemetryEvent(event as ProductTelemetryEvent);
  const analytics = options.analytics ?? getSingletonAnalyticsOptional();
  if (!analytics) return persisted;

  try {
    const status = analytics.getStatus();
    if (!status.initialized) return persisted;

    await analytics.track(event);
    return true;
  } catch (error) {
    console.error('Failed to track product usage event:', error);
    return persisted;
  }
};

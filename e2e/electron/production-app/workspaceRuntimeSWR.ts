interface FixtureSWRConfig<T> {
  fallbackData?: T;
}

/**
 * Prevent network IO in the packaged Electron fixture while preserving real
 * product consumers such as TaskList. Each consumer still renders from its
 * declared fallback data instead of an E2E-owned UI probe.
 */
export const useClientDataSWR = <T>(
  _key: unknown,
  _fetcher: unknown,
  config?: FixtureSWRConfig<T>,
) => ({
  data: config?.fallbackData,
  error: undefined,
  isLoading: false,
  isValidating: false,
  mutate: async () => config?.fallbackData,
});

export const mutate = async () => undefined;

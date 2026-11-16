import type { AiProvider, StructuredRequest } from "@/lib/server/ai/provider";
import { mockProvider } from "@/lib/server/ai/mock";

/**
 * A provider that records every call. Each call's response is the mock
 * provider's valid response, optionally changed by `tamper`.
 */
export function recordingProvider(tamper?: (request: StructuredRequest, data: unknown, callNumber: number) => unknown) {
  const calls: StructuredRequest[] = [];
  const provider: AiProvider = {
    async generate(request) {
      calls.push(request);
      const response = await mockProvider.generate(request);
      return { ...response, data: tamper ? tamper(request, structuredClone(response.data), calls.length) : response.data };
    },
  };
  return { provider, calls };
}

import "server-only";
import { ApiError, errorResponse } from "./http";
import { logEvent } from "./log";
import { ConfigError } from "./token";

/** Wraps a route so every failure becomes the same JSON error shape, and nothing sensitive is logged. */
export async function handle(request: Request, route: string, run: () => Promise<Response>): Promise<Response> {
  const started = Date.now();
  try {
    const response = await run();
    logEvent("request", { route, status: response.status, ms: Date.now() - started });
    return response;
  } catch (error) {
    let apiError: ApiError;
    if (error instanceof ApiError) apiError = error;
    else if (error instanceof ConfigError) apiError = new ApiError("server_misconfigured", "The interview service is not configured correctly. Please try again later.");
    else apiError = new ApiError("internal", "Something went wrong on our side. Please try again.");
    // Only the error code is logged. Messages and stacks can contain request content.
    logEvent("request", { route, status: apiError.status, code: apiError.code, ms: Date.now() - started });
    return errorResponse(request, apiError);
  }
}

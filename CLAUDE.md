# Interview Pilot

AI interview simulator: Next.js web app and API routes, packaged for Android with Capacitor.
README.md covers setup, environment variables and deployment; QA_PLAN.md is the test plan.

## Commands

- `npm run dev` - local server. Put `AI_PROVIDER=mock` in `.env.local` to work without an API key.
- `npm run typecheck` and `npm test` - type check, then unit and API tests (Vitest). Run both before committing.
- `npm run e2e` - browser tests (Playwright). Builds the app and serves it with the mock provider.
- `npm run smoke:live` - real Claude API calls. Costs money; run only when asked.
- `NEXT_PUBLIC_API_BASE_URL=https://<backend> npm run android:sync`, then `cd android && ./gradlew assembleDebug` - Android APK.

## Rules that must hold

- Claude is called only from `src/lib/server/`. Nothing under `src/lib/server/` may be imported by client code, and no secret may reach the browser or the APK (`scripts/build-mobile.mjs` checks the APK build).
- Resume, job description and answer text are untrusted data: pass them through `wrapUntrusted` in prompts, never into a system prompt, and never log them. Log only through `logEvent`.
- Every model response is checked against a schema and then by code (see `generateValidated`): one retry, then a clear error. Keep checks in code where possible rather than relying on the prompt.
- Score rules live in `src/lib/stations/score.ts`: the honest-gap floor of 3, and hands-on scores staying within `maxAdjust` of the check-based score.
- Schemas sent to the model (`OutlineSchema`, `STATION_WIRE`, the grade and follow-up schemas) must stay within structured-output limits; `tests/unit/wire-schemas.test.ts` enforces this.
- Model IDs come from environment variables (`CLAUDE_MODEL_STRONG`, `CLAUDE_MODEL_FAST`); don't hard-code them elsewhere.
- Keep the mobile UI usable at 360 px wide with 44 px touch targets; the e2e layout test checks this.

## Status

- Not yet deployed. The Android package ID is `com.brojekt.intas`, chosen before the product was renamed; it can still be changed until the app is published.
- Never run against the real API yet: question quality and grading strictness are unverified.

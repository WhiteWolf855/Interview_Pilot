# Interview Pilot

An AI interview simulator. A candidate uploads a resume, pastes a job description, and sits a
mock interview built from both: conversation stages with follow-up questions, hands-on
exercises, and a strictly graded debrief.

One codebase produces the website and the Android app (`com.brojekt.intas`).

## How it fits together

```
Browser or Android app (same UI)            Server (Next.js API routes)          Anthropic
  setup, interview, stations, debrief  -->  /api/plan  /api/followup  /api/grade  -->  Claude API
  session kept in local storage             resume parsed in memory, nothing stored
```

- The UI is a Next.js app (TypeScript, React). The Android app is the same UI, statically
  exported and wrapped with Capacitor. It calls the deployed backend over HTTPS.
- All Claude calls happen on the server. `ANTHROPIC_API_KEY` is read only there. The mobile
  build script removes server secrets from its environment and scans the output for them.
- The server keeps no interview state. It signs a token for each plan it creates, and the
  follow-up and grading routes only accept stages that match a token it signed.
- Models: `claude-opus-5-5` builds the interview and grades it; `claude-haiku-5-5` writes the
  live follow-up questions. Both are set by environment variable.

## Local setup

Requires Node.js 20 or later.

```bash
npm install
```

```bash
cp .env.example .env.local
```

Edit `.env.local` and set `ANTHROPIC_API_KEY` and `SESSION_SECRET`. Then:

```bash
npm run dev
```

Open http://localhost:3000.

To work on the UI without an API key and at no cost, set `AI_PROVIDER=mock` in `.env.local`.
The mock returns canned interviews and scores answers by length only. It is for development
and tests, never production.

## Environment variables

Only names starting with `NEXT_PUBLIC_` reach the browser or the app. Everything else is server only.

| Variable | Required | Default | What it does |
|---|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | | Your Anthropic API key. Server only. |
| `SESSION_SECRET` | Yes in production | random per process in development | Signs interview tokens. At least 16 characters. Generate with `openssl rand -hex 32`. |
| `CLAUDE_MODEL_STRONG` | No | `claude-opus-5-5` | Builds and grades interviews. |
| `CLAUDE_MODEL_FAST` | No | `claude-haiku-5-5` | Writes follow-up questions. |
| `CLAUDE_EFFORT_PLAN` / `_GRADE` / `_FOLLOWUP` | No | `medium` / `high` / `low` | How hard the model works on each task. Higher is slower and costs more. |
| `CLAUDE_REFUSAL_FALLBACK` | No | on | If the strong model declines a request, Anthropic re-runs it on a fallback model. This uses a beta API feature; set to `off` to disable it. |
| `MAX_INTERVIEWS_PER_DAY` | No | `5` | New interviews per visitor address per day. |
| `GLOBAL_MAX_INTERVIEWS_PER_DAY` | No | `300` | New interviews per day across everyone. Your hard ceiling on spend. |
| `RATE_PLAN_PER_MINUTE` / `RATE_FOLLOWUP_PER_MINUTE` / `RATE_GRADE_PER_MINUTE` | No | `3` / `30` / `10` | Burst limits per visitor address. |
| `MAX_FOLLOWUPS_PER_INTERVIEW` / `MAX_GRADES_PER_INTERVIEW` | No | `60` / `40` | Caps per interview, including reruns. |
| `CLIENT_IP_HEADER` | No | `x-forwarded-for` | The header your host puts the visitor's address in. |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | On serverless hosts | | Shared store for the limits above. `KV_REST_API_URL` / `KV_REST_API_TOKEN` (the names Vercel's Upstash integration may use) also work. |
| `ALLOWED_ORIGINS` | No | `https://localhost,capacitor://localhost` | Other origins allowed to call the API. The default covers the Android app. |
| `NEXT_PUBLIC_API_BASE_URL` | For the Android build | | Public HTTPS address of the deployed backend. |
| `AI_PROVIDER` | No | | `mock` for development without a key. |

### Cost and limits

Each new interview makes one outline call and one call per hands-on exercise on the strong
model, up to two cheap follow-up calls per conversation stage, and one grading call. I have
not measured real usage; at Anthropic's listed prices a 45-minute interview should cost
somewhere around 0.50 to 1 US dollar. Measure it with your own key before setting the caps.

Your worst-case daily spend is roughly `GLOBAL_MAX_INTERVIEWS_PER_DAY` times the cost of one
interview. Also set a spend limit in the Anthropic Console.

The limits are counted per visitor address. Without the Upstash variables the counters live
in the server's memory, which is correct for one long-running server but not for serverless
hosts, where each instance would count separately. Set the Upstash variables there.

## Tests

```bash
npm test
```

Unit and API tests (Vitest): resume parser, plan validation, each hands-on station's
simulator and grading, score rules, rate limiter, session tokens, API routes, colour contrast.

```bash
npm run e2e
```

Browser tests (Playwright, phone viewport). They build the app, start it with the mock
provider, and run whole interviews. Run `npx playwright install chromium` once first.

```bash
npm run smoke:live
```

Calls the real Claude API with the production prompts and prints the plan, follow-ups and
debrief for you to read. It needs `ANTHROPIC_API_KEY` in your shell and makes billed calls.

`QA_PLAN.md` lists everything that should be tested, including the manual Android checklist.

## Deploy the web app

The app is a standard Next.js project. Any host that runs Next.js with Node.js works.

### Vercel

1. Push this folder to a Git repository and import it in Vercel.
2. Add the environment variables: `ANTHROPIC_API_KEY`, `SESSION_SECRET`, and the two
   `UPSTASH_REDIS_REST_*` values (create a free Redis database at Upstash).
3. Deploy.

Building an interview and grading it can each take up to a minute or more. The routes ask
for a 300-second limit (`maxDuration`). Check that your plan allows it; if the limit is
lower, long requests will be cut off and the user will see an error.

### Your own server

```bash
npm run build
```

```bash
npm start
```

Run it behind a reverse proxy that terminates HTTPS and sets `X-Forwarded-For`. With a
single server process you do not need Upstash. Set the same environment variables as above.

### After deploying

Open `https://your-domain/api/health`. It should return
`{"ok":true,"mock":false,"limits":"shared"}`. `ok` means the API key is present; `limits`
says `shared` when the Upstash store is connected and `memory` when it is not. Then run one
interview yourself.

## Build the Android app

You need the deployed backend first, because the app calls it.

Requirements: JDK 21, and the Android SDK (install Android Studio, or the command-line tools
with `platform-tools`, `platforms;android-36` and `build-tools;36.0.0`). Set `ANDROID_HOME`
to the SDK folder.

1. Build the UI for the app and copy it into the Android project. Use your own backend address:

```bash
NEXT_PUBLIC_API_BASE_URL=https://your-domain.example npm run android:sync
```

2. Build a debug APK:

```bash
cd android && ./gradlew assembleDebug
```

The APK is at `android/app/build/outputs/apk/debug/app-debug.apk`. Install it on a phone with
`adb install`, or copy it over and open it.

For the Play Store you need a signed release build: create a keystore, configure signing in
`android/app/build.gradle`, and run `./gradlew bundleRelease`. See the Android documentation
on app signing. The app's package ID is `com.brojekt.intas`; it cannot be changed after you publish.

Notes:

- The app's requests come from the origin `https://localhost`, which the backend allows by
  default through `ALLOWED_ORIGINS`.
- Changing the UI means rebuilding and reshipping the APK. To ship a thin wrapper around the
  live website instead, run `CAP_SERVER_URL=https://your-domain.example npx cap sync android`
  before building. The app then loads the site directly and needs a connection to open.
- Android backups are turned off for the app, so interviews are not copied to cloud backup.
- Dictation uses the phone's speech recogniser and asks for the microphone permission.

## Privacy

- Resumes are parsed in memory and discarded. Nothing is written to disk or a database.
- Logs contain timings, status codes and token counts only. The logging function accepts a
  fixed list of short fields, and tests check that no resume, posting or answer text is logged.
- The interview, answers and debrief live in the user's local storage. The privacy page has a
  delete-my-data button that clears them.
- Resume text, the job description and answers are sent to Anthropic's API to generate
  questions and grades. Say so in your own privacy policy, and check Anthropic's data
  retention terms for your account.

There are no accounts in this version. If you add them, add consent before storing any resume.

## How the AI rules are enforced

Prompts ask for the right behaviour, and code checks what it can:

| Rule | Enforced in code by |
|---|---|
| Questions come from the resume and posting | Each question carries a quote, which is checked against the source text. Unverified quotes are not shown. |
| At least one failure and one proactive question | Plan validation rejects a plan without them. |
| No invented numbers | Percentages, money and large numbers in questions, follow-ups and the rewritten answer must appear in the source material. |
| Code exercise only if the resume shows coding | A keyword check on the resume. The plan is rejected if it uses the code station otherwise. |
| Non-technical roles get non-technical exercises | Plan validation restricts them to the written and data stations. |
| An honest gap with a sound approach scores at least 3 | The grader flags it; the floor is applied in code. |
| Hands-on scores follow the automatic checks | The model may move the check-based score by at most 1 (2 for writing). |
| The tighter answer uses only the candidate's facts | Its supporting quotes must be found in the candidate's own answers. |
| Pasted text cannot give instructions | Resume, posting and answers go in data blocks named with a random per-request suffix, separate from the rules. |
| Invalid model output | One retry with the reasons, then a clear error. A hands-on exercise that fails twice is replaced by a built-in one. |

Generated terminal and API exercises are verified by replaying the model's own solution in
the simulator. Data exercise answers are computed from the table, never taken from the model.
Code exercises are verified in the browser by running the reference solution.

What code cannot check is whether the questions are good and the grading is fair. Read the
output of `npm run smoke:live` for that.

## Project layout

```
src/app/                 pages (setup, interview, debrief, privacy) and API routes
src/components/          screens, the interview runner, one component per station
src/lib/schemas/         plan, station and debrief schemas and their validation rules
src/lib/server/          Claude client, prompts, mock provider, resume parser, limits, tokens
src/lib/stations/        simulator and grader for each station, plus built-in scenarios
src/lib/interview/       state machine, clock, local storage, export
src/lib/guards/          untrusted-data wrapping, number, quote and coding-evidence checks
tests/                   unit, api, e2e and live tests
android/                 the Capacitor Android project
scripts/                 mobile build and test server scripts
```

## Known limits

- Code exercises are JavaScript only.
- Dictation depends on the browser or phone having a speech recogniser. Where there is none,
  the button is hidden.
- The per-address limits treat everyone behind one shared address (an office, a mobile
  carrier) as one visitor.
- Legacy `.doc` files and scanned PDFs are rejected with a message asking for pasted text.

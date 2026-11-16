// Builds the static UI that is bundled into the Android app, then checks that
// nothing server-side or secret ended up in it.
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";
const allowHttp = process.env.ALLOW_INSECURE_API_BASE === "1";
if (!/^https:\/\/[^/]+/.test(apiBase) && !(allowHttp && /^http:\/\//.test(apiBase))) {
  console.error(
    "Set NEXT_PUBLIC_API_BASE_URL to the HTTPS address of your deployed backend, for example:\n" +
      "  NEXT_PUBLIC_API_BASE_URL=https://intas.example.com npm run build:mobile\n" +
      "The Android app has no server inside it, so it must know where the backend is.",
  );
  process.exit(1);
}

// The mobile build must never see server secrets, so they are removed from its environment.
const env = { ...process.env, BUILD_TARGET: "mobile" };
for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "SESSION_SECRET", "UPSTASH_REDIS_REST_TOKEN"]) delete env[name];

execFileSync("npx", ["next", "build"], { stdio: "inherit", env });

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

if (!existsSync("out/index.html")) {
  console.error("The static export did not produce out/index.html.");
  process.exit(1);
}
const files = walk("out");
const problems = [];
if (files.some((file) => file.startsWith(join("out", "api")))) problems.push("API routes were exported into the app bundle");
const secretPattern = /sk-ant-[A-Za-z0-9_-]{8,}|ANTHROPIC_API_KEY|SESSION_SECRET/;
for (const file of files) {
  if (!/\.(js|html|txt|json|css)$/.test(file)) continue;
  if (secretPattern.test(readFileSync(file, "utf8"))) problems.push(`possible secret or server setting name in ${file}`);
}
if (problems.length) {
  console.error("Mobile build check failed:\n- " + problems.join("\n- "));
  process.exit(1);
}
console.log(`Mobile build ready in ./out (${files.length} files). No API routes or secrets found. Backend: ${apiBase}`);

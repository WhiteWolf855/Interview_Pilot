import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Android app bundles the statically exported UI from ./out and calls the
 * deployed backend over HTTPS (see NEXT_PUBLIC_API_BASE_URL in the README).
 *
 * To ship a thin wrapper around the live website instead, set CAP_SERVER_URL
 * to the site's address before running `npx cap sync android`.
 */
const config: CapacitorConfig = {
  appId: "com.brojekt.intas",
  appName: "Interview Pilot",
  webDir: "out",
  server: {
    androidScheme: "https",
    ...(process.env.CAP_SERVER_URL ? { url: process.env.CAP_SERVER_URL } : {}),
  },
  android: { allowMixedContent: false },
};

export default config;

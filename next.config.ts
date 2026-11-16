import type { NextConfig } from "next";

/**
 * Two build targets from one codebase:
 *  - web (default): the site plus the API routes, deployed to a Node host.
 *  - mobile (BUILD_TARGET=mobile): a static export of the UI only, bundled into
 *    the Android app. API routes are left out by only treating .tsx files as
 *    routes; the app calls the deployed backend at NEXT_PUBLIC_API_BASE_URL.
 */
const mobile = process.env.BUILD_TARGET === "mobile";

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  serverExternalPackages: ["unpdf", "mammoth"],
  ...(mobile
    ? { output: "export" as const, pageExtensions: ["tsx"], trailingSlash: true, images: { unoptimized: true } }
    : {}),
};

export default config;

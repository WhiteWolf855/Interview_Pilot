import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { APP } from "@/lib/config";
import { THEMES, themeCss } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: `${APP.name}: ${APP.tagline}`,
  description: "Upload your resume, paste a job description, and sit a realistic mock interview tailored to that role, with a graded debrief.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: THEMES.light.surface },
    { media: "(prefers-color-scheme: dark)", color: THEMES.dark.surface },
  ],
};

// Applies a saved theme choice before the page paints, to avoid a flash.
const themeScript = `try{var t=localStorage.getItem("intas.theme");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <style dangerouslySetInnerHTML={{ __html: themeCss() }} />
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}

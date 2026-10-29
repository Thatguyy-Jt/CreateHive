import { ClerkProvider } from "@clerk/nextjs";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import type { Metadata } from "next";
import { geistMono, instrumentSerif, manrope } from "@/app/fonts";
import "./globals.css";

// Maps Clerk's components onto the design-system tokens. The values are CSS
// variables, so Clerk follows the same light/dark switch as the rest of the app.
const clerkAppearance = {
  variables: {
    colorPrimary: "var(--primary)",
    colorPrimaryForeground: "var(--primary-foreground)",
    colorForeground: "var(--foreground)",
    // Clerk derives button labels and menu items from this. Its default is a
    // dark neutral, which disappears on the dark theme.
    colorNeutral: "var(--foreground)",
    colorMutedForeground: "var(--muted-foreground)",
    colorBackground: "var(--surface)",
    colorInput: "var(--background)",
    colorInputForeground: "var(--foreground)",
    colorBorder: "var(--border)",
    colorRing: "var(--ring)",
    colorDanger: "var(--danger)",
    // The logged-in app sets --font-app (Nunito Sans); auth pages fall back to Manrope.
    fontFamily: "var(--font-app, var(--font-manrope)), ui-sans-serif, system-ui, sans-serif",
    borderRadius: "0.75rem",
  },
};

export const metadata: Metadata = {
  title: {
    default: "CreateHive · AI strategist for creators",
    template: "%s · CreateHive",
  },
  description:
    "CreateHive helps creators decide what to create, how to create it, and what to do next based on their own results.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} ${instrumentSerif.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ClerkProvider
          signInUrl="/sign-in"
          signUpUrl="/sign-up"
          afterSignOutUrl="/"
          signInFallbackRedirectUrl="/app"
          signUpFallbackRedirectUrl="/app"
          appearance={clerkAppearance}
        >
          {children}
        </ClerkProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}

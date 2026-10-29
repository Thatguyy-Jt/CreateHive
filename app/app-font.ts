import { Nunito_Sans } from "next/font/google";

// The logged-in app's single family (globals.css section 11), in its own
// module: Next preloads every font whose loader module a route imports, so
// keeping it out of app/fonts.ts (imported by the root layout) keeps it off
// the marketing pages. Imported only by app/app/layout.tsx and
// app/onboarding/layout.tsx. Only the three weights the app uses are loaded,
// so 500/600 resolve to 400/700.
export const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
  weight: ["400", "700", "800"],
});

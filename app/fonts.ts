import { Geist_Mono, Instrument_Serif, Manrope } from "next/font/google";

// The root layout's fonts. Next preloads every font whose loader module a
// route imports, so the logged-in app's Nunito Sans lives in app/app-font.ts,
// imported only by the logged-in layouts.

export const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

export const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
});

// Only `code`, `kbd` and `pre` use it: loaded when needed, never preloaded.
export const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false,
});

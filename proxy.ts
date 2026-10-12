import { clerkMiddleware } from "@clerk/nextjs/server";

// Bare middleware: it only makes the session available. Each page, route
// handler and server action protects itself with `auth.protect()`. The URLs
// make that server-side redirect land on our own pages, not Clerk's hosted ones.
export default clerkMiddleware({ signInUrl: "/sign-in", signUpUrl: "/sign-up" });

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};

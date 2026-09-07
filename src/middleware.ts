import { clerkMiddleware } from "@clerk/nextjs/server";

/**
 * Core 3: keep clerkMiddleware for session/handshake, but do not gate by path
 * with createRouteMatcher (deprecated). Auth checks live on each resource.
 */
export default clerkMiddleware();

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};

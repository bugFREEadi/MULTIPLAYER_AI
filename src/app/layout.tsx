import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

export const metadata: Metadata = {
  title: "Multiplayer AI",
  description: "Collaborative AI work sessions for teams",
};

function hasRealClerkKeys() {
  return (
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
    Boolean(process.env.CLERK_SECRET_KEY) &&
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.includes("placeholder") &&
    !process.env.CLERK_SECRET_KEY?.includes("placeholder")
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-neutral-900 antialiased">
        {hasRealClerkKeys() ? (
          <ClerkProvider afterSignOutUrl="/sign-in">{children}</ClerkProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}

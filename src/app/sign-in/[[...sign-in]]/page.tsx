import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

function hasRealClerkKeys() {
  return (
    Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
    Boolean(process.env.CLERK_SECRET_KEY) &&
    !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.includes("placeholder") &&
    !process.env.CLERK_SECRET_KEY?.includes("placeholder")
  );
}

export default function SignInPage() {
  if (!hasRealClerkKeys()) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">Sign in unavailable</h1>
        <p className="text-neutral-600">
          Add real Clerk keys to <code>.env.local</code>, restart{" "}
          <code>npm run dev</code>, then reload this page.
        </p>
        <Link href="/" className="text-sm underline">
          ← Home
        </Link>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
      <SignIn
        forceRedirectUrl="/sessions"
        signUpUrl="/sign-up"
        appearance={{
          elements: {
            rootBox: "mx-auto",
          },
        }}
      />
    </main>
  );
}

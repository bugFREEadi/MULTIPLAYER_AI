import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";

const hasClerkKeys =
  Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) &&
  !process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?.includes("placeholder");

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-6 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Multiplayer AI</h1>
      <p className="text-neutral-600">
        Session CRUD API is available at <code>/api/sessions</code>.
      </p>
      {hasClerkKeys ? (
        <>
          <SignedOut>
            <SignInButton mode="modal">
              <button className="rounded-md bg-neutral-900 px-4 py-2 text-sm text-white">
                Sign in
              </button>
            </SignInButton>
          </SignedOut>
          <SignedIn>
            <UserButton />
          </SignedIn>
        </>
      ) : (
        <p className="text-sm text-neutral-500">
          Clerk keys not configured — use{" "}
          <code>ALLOW_DEV_AUTH</code> + <code>x-dev-clerk-id</code> for API
          testing.
        </p>
      )}
    </main>
  );
}

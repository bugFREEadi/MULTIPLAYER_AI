import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/nextjs";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-start justify-center gap-6 px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Multiplayer AI</h1>
      <p className="text-neutral-600">
        Phase 0 setup is in place. Shared AI work sessions come next.
      </p>
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
    </main>
  );
}

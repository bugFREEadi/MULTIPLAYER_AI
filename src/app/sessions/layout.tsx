import { auth } from "@clerk/nextjs/server";

/** Resource-level protection for all /sessions routes (Core 3 pattern). */
export default async function SessionsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await auth.protect();
  return children;
}

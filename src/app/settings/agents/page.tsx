import { auth } from "@clerk/nextjs/server";
import AgentsClient from "./agents-client";

export default async function AgentsPage() {
  await auth.protect();
  return <AgentsClient />;
}

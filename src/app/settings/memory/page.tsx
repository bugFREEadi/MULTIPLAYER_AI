import { auth } from "@clerk/nextjs/server";
import MemoryCurationClient from "./memory-client";

export default async function MemorySettingsPage() {
  await auth.protect();
  return <MemoryCurationClient />;
}

import { auth } from "@clerk/nextjs/server";
import PatternsClient from "./patterns-client";

export default async function PatternsPage() {
  await auth.protect();
  return <PatternsClient />;
}

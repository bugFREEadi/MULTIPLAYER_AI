import { auth } from "@clerk/nextjs/server";
import ToolsClient from "./tools-client";

export default async function ToolsPage() {
  await auth.protect();
  return <ToolsClient />;
}

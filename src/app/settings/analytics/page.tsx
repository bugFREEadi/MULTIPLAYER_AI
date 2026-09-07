import { auth } from "@clerk/nextjs/server";
import AnalyticsClient from "./analytics-client";

export default async function AnalyticsPage() {
  await auth.protect();
  return <AnalyticsClient />;
}

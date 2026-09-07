import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import {
  managerNodeCompleted,
  scheduledBudgetChecks,
  scheduledHandoffs,
  scheduledMemoryExtraction,
} from "@/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    scheduledHandoffs,
    scheduledBudgetChecks,
    scheduledMemoryExtraction,
    managerNodeCompleted,
  ],
});

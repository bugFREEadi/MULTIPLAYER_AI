import { auth } from "@clerk/nextjs/server";
import BudgetClient from "./budget-client";

export default async function BudgetPage() {
  await auth.protect();
  return <BudgetClient />;
}

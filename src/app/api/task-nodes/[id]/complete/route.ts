import { eq } from "drizzle-orm";
import { db } from "@/db";
import { taskNodes } from "@/db/schema";
import { AuthError, jsonError, requireAppUser } from "@/lib/auth";
import { completeTaskNode, getTaskGraphById } from "@/lib/manager-agent";
import { requireSessionPermission } from "@/lib/rbac";

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/task-nodes/:id/complete — mark a node done and advance the graph.
 */
export async function POST(_request: Request, context: RouteContext) {
  try {
    const user = await requireAppUser();
    const { id: nodeId } = await context.params;

    const [node] = await db
      .select()
      .from(taskNodes)
      .where(eq(taskNodes.id, nodeId))
      .limit(1);
    if (!node) {
      throw new AuthError("Task node not found", 404);
    }
    const bundle = await getTaskGraphById(node.taskGraphId);
    if (!bundle) {
      throw new AuthError("Task graph not found", 404);
    }
    await requireSessionPermission(
      user,
      bundle.graph.parentSessionId,
      "session.handoff"
    );

    const result = await completeTaskNode({
      nodeId,
      actorId: user.id,
    });

    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

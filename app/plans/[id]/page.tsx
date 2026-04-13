import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import SharedPlanView from "@/components/shared-plan-view";

export const dynamic = "force-dynamic";

export default async function PlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getSession();
  if (!session) notFound();

  let plan;
  try {
    const { rows } = await sql`
      SELECT sp.id, sp.name, sp.notes, sp.type, sp.visibility, sp.inputs, sp.result,
             sp.created_at, u.name AS creator_name, sp.created_by
      FROM saved_plans sp JOIN users u ON u.id = sp.created_by
      WHERE sp.id = ${id}
    `;
    plan = rows[0];
  } catch {
    notFound();
  }

  if (!plan) notFound();

  const canView =
    session.role === "admin" ||
    plan.created_by === session.userId ||
    plan.visibility === "shared" ||
    plan.visibility === "link";

  if (!canView) notFound();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return <SharedPlanView plan={plan as any} backHref="/plans" />;
}

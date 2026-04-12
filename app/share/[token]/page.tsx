import { sql } from "@/lib/db";
import SharedPlanView from "@/components/shared-plan-view";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let plan;
  try {
    const { rows } = await sql`
      SELECT sp.id, sp.name, sp.notes, sp.type, sp.visibility, sp.inputs, sp.result,
             sp.created_at, u.name AS creator_name
      FROM saved_plans sp JOIN users u ON u.id = sp.created_by
      WHERE sp.share_token = ${token}
        AND sp.visibility = 'link'
    `;
    plan = rows[0];
  } catch {
    notFound();
  }

  if (!plan) notFound();

  return <SharedPlanView plan={plan as Parameters<typeof SharedPlanView>[0]["plan"]} />;
}

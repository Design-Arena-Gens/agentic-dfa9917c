import { NextResponse } from "next/server";
import { getAgents } from "@/lib/datastore";

export async function GET() {
  return NextResponse.json({
    agents: getAgents(),
    generatedAt: new Date().toISOString(),
  });
}

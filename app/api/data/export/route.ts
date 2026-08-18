import { NextResponse } from "next/server";
import { dbErrorResponse, getAllData } from "@/lib/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    const data = await getAllData();
    return NextResponse.json(data);
  } catch (err) {
    return dbErrorResponse(err, "데이터를 내보내지 못했어요.");
  }
}

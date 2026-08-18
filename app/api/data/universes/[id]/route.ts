import { NextResponse } from "next/server";
import { dbErrorResponse, deleteUniverse } from "@/lib/db";
import { ORG_UNIVERSE_ID } from "@/lib/types";

export const runtime = "nodejs";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (id === ORG_UNIVERSE_ID) {
    return NextResponse.json(
      { error: "오리지널 세계관은 삭제할 수 없어요." },
      { status: 400 }
    );
  }
  try {
    await deleteUniverse(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return dbErrorResponse(err, "세계관을 삭제하지 못했어요.");
  }
}

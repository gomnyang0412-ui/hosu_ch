import { NextResponse } from "next/server";
import {
  DbConfigError,
  clearObservationSession,
  getObservationSession,
  saveObservationSession,
} from "@/lib/db";
import type { ObservationSession } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ universeId: string }> }
) {
  const { universeId } = await params;
  try {
    const session = await getObservationSession(universeId);
    return NextResponse.json({ session });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "관찰 장면을 불러오지 못했어요.",
      },
      { status: 502 }
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ universeId: string }> }
) {
  const { universeId } = await params;
  let session: ObservationSession;
  try {
    session = await request.json();
  } catch {
    return NextResponse.json({ error: "잘못된 요청이에요." }, { status: 400 });
  }
  try {
    await saveObservationSession({ ...session, universeId });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "관찰 장면을 저장하지 못했어요.",
      },
      { status: 502 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ universeId: string }> }
) {
  const { universeId } = await params;
  try {
    await clearObservationSession(universeId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof DbConfigError
            ? err.message
            : "관찰 장면을 지우지 못했어요.",
      },
      { status: 502 }
    );
  }
}

import { NextResponse } from "next/server";
import pTimeout from "p-timeout";
import { supabase } from "@/utils/supabase";
import { generateTemplate } from "@/utils/aiClient";
import { deployOnVercel } from "@/utils/vercelDeploy";
import { captureThumbnail } from "@/utils/thumbnail";
import { sendTextMessage, sendImageMessage } from "@/utils/whatsapp";

export async function POST(request: Request) {
  let requestId: string | undefined;

  try {
    const { id } = (await request.json()) as { id: string };
    requestId = id;

    await supabase
      .from("requests")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", id);

    const { data: siteRequest } = await supabase
      .from("requests")
      .select("*")
      .eq("id", id)
      .single();

    // ✅ Corrigido: segundo parâmetro agora é objeto { timeout }
    const templateCode = await pTimeout(
      generateTemplate(siteRequest.prompt),
      { milliseconds: 2 * 60_000 }
    );

    const deployed = await pTimeout(
      deployOnVercel(
        templateCode,
        siteRequest.project_id,
        siteRequest.user_phone
      ),
      { milliseconds: 4 * 60_000 }
    );

    // ✅ Verificação segura do `.url`
    const vercelUrl = deployed?.url;
    if (!vercelUrl) {
      throw new Error("Vercel deployment failed: missing URL.");
    }

    const { data: prev } = await supabase
      .from("requests")
      .select("thumbnail_url, updated_at")
      .eq("vercel_url", vercelUrl)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();

    let thumbnailUrl = prev?.thumbnail_url;
    const tooOld =
      prev &&
      Date.now() - new Date(prev.updated_at).getTime() > 60 * 60_000;

    // ✅ Checagem segura para string | undefined
    if (!thumbnailUrl || tooOld) {
      thumbnailUrl = await captureThumbnail(vercelUrl);
    }

    await supabase
      .from("requests")
      .update({
        status: "completed",
        vercel_url: vercelUrl,
        thumbnail_url: thumbnailUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (thumbnailUrl) {
      await sendImageMessage(siteRequest.user_phone, thumbnailUrl);
    }

    await sendTextMessage(
      siteRequest.user_phone,
      `✅ Seu site está pronto!\n\n🌐 ${vercelUrl}\n(Link válido por 24h)`
    );

    return NextResponse.json({ success: true });

  } catch (err: any) {
    if (requestId) {
      await supabase
        .from("requests")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", requestId);

      const { data: row } = await supabase
        .from("requests")
        .select("user_phone")
        .eq("id", requestId)
        .single();

      if (row?.user_phone) {
        await sendTextMessage(
          row.user_phone,
          `❌ Ocorreu um erro: ${(err && err.message) || err}`
        );
      }
    }

    return NextResponse.json(
      { error: (err && err.message) || "Unknown error" },
      { status: 500 }
    );
  }
}

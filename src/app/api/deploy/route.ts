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
    console.log(`\n[DEPLOY] 🚀 Starting deploy for request id=${id}`);

    /* ───────────────── 1) MARK REQUEST AS PROCESSING ───────────────── */
    const { error: markProcErr } = await supabase
      .from("requests")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", id);
    if (markProcErr) console.error("[DEPLOY] 🔴 Mark processing error:", markProcErr);

    /* ───────────────── 2) FETCH REQUEST ROW ───────────────── */
    const { data: siteRequest, error: fetchReqErr } = await supabase
      .from("requests")
      .select("*")
      .eq("id", id)
      .single();
    if (fetchReqErr) throw fetchReqErr;
    console.log("[DEPLOY] 🗂️ Request row:", siteRequest);

    /* ───────────────── 3) GENERATE TEMPLATE CODE ───────────────── */
    console.log("[DEPLOY] 🧠 Generating template via AI…");
    const templateCode = await pTimeout(generateTemplate(siteRequest.prompt), {
      milliseconds: 2 * 60_000,
    });
    console.log("[DEPLOY] ✅ Template generated (length:", templateCode.length, ")");

    /* ───────────────── 4) DEPLOY TO VERCEL ───────────────── */
    console.log("[DEPLOY] 🚀 Deploying to Vercel…");
    const deployed = await pTimeout(
      deployOnVercel(templateCode, siteRequest.project_id, siteRequest.user_phone),
      { milliseconds: 4 * 60_000 }
    );

    const vercelUrl = deployed?.url;
    if (!vercelUrl) {
      throw new Error("Vercel deployment failed: missing URL.");
    }
    console.log("[DEPLOY] ✅ Deployed at", vercelUrl);

    /* ───────────────── 5) THUMBNAIL CACHE / GENERATION ───────────────── */
    const { data: prev, error: thumbPrevErr } = await supabase
      .from("requests")
      .select("thumbnail_url, updated_at")
      .eq("vercel_url", vercelUrl)
      .order("updated_at", { ascending: false })
      .limit(1)
      .single();
    if (thumbPrevErr) console.error("[DEPLOY] 🔴 Thumb prev fetch error:", thumbPrevErr);

    let thumbnailUrl = prev?.thumbnail_url;
    const tooOld =
      prev && Date.now() - new Date(prev.updated_at).getTime() > 60 * 60_000; // >1h

    if (!thumbnailUrl || tooOld) {
      console.log("[DEPLOY] 📸 Capturing new thumbnail…");
      thumbnailUrl = await captureThumbnail(vercelUrl);
      console.log("[DEPLOY] ✅ Thumbnail captured:", thumbnailUrl);
    } else {
      console.log("[DEPLOY] 🎯 Reusing cached thumbnail");
    }

    /* ───────────────── 6) UPDATE REQUEST ROW ───────────────── */
    const { error: updReqErr } = await supabase
      .from("requests")
      .update({
        status: "completed",
        vercel_url: vercelUrl,
        thumbnail_url: thumbnailUrl,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);
    if (updReqErr) console.error("[DEPLOY] 🔴 Update request error:", updReqErr);

    /* ───────────────── 7) NOTIFY USER ───────────────── */
    if (thumbnailUrl) {
      await sendImageMessage(siteRequest.user_phone, thumbnailUrl).catch(err =>
        console.error("[DEPLOY] 🔴 sendImageMessage error:", err)
      );
    }

    await sendTextMessage(
      siteRequest.user_phone,
      `✅ Seu site está pronto!\n\n🌐 ${vercelUrl}\n(Link válido por 24h)`
    ).catch(err => console.error("[DEPLOY] 🔴 sendTextMessage error:", err));

    console.log("[DEPLOY] 🎉 Finished successfully");
    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("[DEPLOY] 🔴 Caught error:", err);

    if (requestId) {
      const { error: markFailErr } = await supabase
        .from("requests")
        .update({ status: "failed", updated_at: new Date().toISOString() })
        .eq("id", requestId);
      if (markFailErr) console.error("[DEPLOY] 🔴 Mark failed error:", markFailErr);

      const { data: row, error: rowErr } = await supabase
        .from("requests")
        .select("user_phone")
        .eq("id", requestId)
        .single();
      if (rowErr) console.error("[DEPLOY] 🔴 Fetch user_phone error:", rowErr);

      if (row?.user_phone) {
        await sendTextMessage(
          row.user_phone,
          `❌ Ocorreu um erro: ${(err && err.message) || err}`
        ).catch(e => console.error("[DEPLOY] 🔴 sendTextMessage error:", e));
      }
    }

    return NextResponse.json(
      { error: (err && err.message) || "Unknown error" },
      { status: 500 }
    );
  }
}
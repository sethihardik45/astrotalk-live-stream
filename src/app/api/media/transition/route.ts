import fs from "node:fs";
import { Readable } from "node:stream";
import { findTransitionVideo } from "@/lib/media";

export const dynamic = "force-dynamic";

/**
 * GET /api/media/transition — serves the ops-uploaded transition video. PUBLIC on purpose: LiveKit's egress browser has to be
 * able to load it. It only ever serves that one file. Supports HTTP "Range" requests, which Chrome needs to loop video smoothly.
 */
export async function GET(req: Request) {
  const v = await findTransitionVideo();
  if (!v) return new Response("Not found", { status: 404 });
  const type = v.kind === "mp4" ? "video/mp4" : "video/webm";
  const common = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "public, max-age=300" };

  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
  // "bytes=-" (nothing at all) is meaningless: treat it like no Range header.
  if (range && (range[1] || range[2])) {
    let start = range[1] ? Number(range[1]) : NaN;
    let end = range[2] ? Number(range[2]) : NaN;
    if (Number.isNaN(start)) {
      // "bytes=-500" means the last 500 bytes
      start = Math.max(0, v.size - end);
      end = v.size - 1;
    } else if (Number.isNaN(end) || end >= v.size) end = v.size - 1;
    if (start > end || start >= v.size) return new Response(null, { status: 416, headers: { ...common, "Content-Range": `bytes */${v.size}` } });
    const stream = Readable.toWeb(fs.createReadStream(v.file, { start, end })) as unknown as ReadableStream;
    return new Response(stream, { status: 206, headers: { ...common, "Content-Range": `bytes ${start}-${end}/${v.size}`, "Content-Length": String(end - start + 1) } });
  }
  const stream = Readable.toWeb(fs.createReadStream(v.file)) as unknown as ReadableStream;
  return new Response(stream, { status: 200, headers: { ...common, "Content-Length": String(v.size) } });
}

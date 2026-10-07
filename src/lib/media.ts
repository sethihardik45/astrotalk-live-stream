import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./env";

/**
 * The ops-uploaded transition video. Stored as a single file in UPLOAD_DIR and served from /api/media/transition.
 * We decide the file type from its first bytes (not from the name the browser gives us), because names can lie.
 */
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;

export type VideoKind = "mp4" | "webm";

export function sniffVideo(head: Uint8Array): VideoKind | null {
  // MP4 / MOV family: bytes 4-7 spell "ftyp"
  if (head.length >= 12 && head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70) return "mp4";
  // WebM / Matroska: EBML header 1A 45 DF A3
  if (head.length >= 4 && head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3) return "webm";
  return null;
}

export const uploadDir = () => path.resolve(env().UPLOAD_DIR);
export const videoPath = (kind: VideoKind) => path.join(uploadDir(), `transition.${kind}`);

export async function saveTransitionVideo(bytes: Uint8Array, kind: VideoKind) {
  await fs.mkdir(uploadDir(), { recursive: true });
  await removeTransitionVideo();
  await fs.writeFile(videoPath(kind), bytes);
}

export async function removeTransitionVideo() {
  for (const k of ["mp4", "webm"] as const) await fs.rm(videoPath(k), { force: true });
}

export async function findTransitionVideo(): Promise<{ kind: VideoKind; file: string; size: number } | null> {
  for (const kind of ["mp4", "webm"] as const) {
    try {
      const st = await fs.stat(videoPath(kind));
      return { kind, file: videoPath(kind), size: st.size };
    } catch {
      /* try next */
    }
  }
  return null;
}

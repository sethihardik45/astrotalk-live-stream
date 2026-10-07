/**
 * Build the final RTMP(S) destination from the two things Instagram Live Producer shows:
 *   Server URL   e.g. rtmps://live-upload.instagram.com:443/rtmp/
 *   Stream key   e.g. 17890...?s_bl=1&s_psm=1&s_sc=...&s_sw=0&s_vt=api-s&a=...
 *
 * The result is  serverUrl + "/" + streamKey  with exactly ONE slash between them, no matter whether
 * the server URL ends with "/" or the key starts with one. The stream key itself is passed through
 * untouched (it can legitimately contain "?" and "&").
 *
 * IMPORTANT: the return value is a SECRET. Never log it, store it, or send it to the browser.
 */
export class RtmpInputError extends Error {}

export function joinRtmpUrl(serverUrl: string, streamKey: string): string {
  const server = serverUrl.trim();
  const key = streamKey.trim();

  if (!/^rtmps?:\/\//i.test(server)) {
    throw new RtmpInputError("The Server URL must start with rtmp:// or rtmps://");
  }
  if (!key) throw new RtmpInputError("The Stream Key is empty");
  if (/\s/.test(server) || /\s/.test(key)) {
    throw new RtmpInputError("The Server URL and Stream Key must not contain spaces");
  }

  const base = server.replace(/\/+$/, "");
  const cleanKey = key.replace(/^\/+/, "");
  return `${base}/${cleanKey}`;
}

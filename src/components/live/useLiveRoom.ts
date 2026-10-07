"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ConnectionQuality, ConnectionState, DisconnectReason, Room, RoomEvent, Track } from "livekit-client";
import { audioPublishOptions, videoPublishOptions } from "./capture";
import type { LocalMedia } from "./useLocalMedia";

export type RoomConn = "idle" | "connecting" | "connected" | "reconnecting" | "disconnected";

interface Options {
  slug: string;
  /** Be in the LiveKit room (green room and on air). */
  wantConnection: boolean;
  /** The clock says it is this astrologer's turn: publish if (and only if) the SERVER has granted permission. */
  wantPublish: boolean;
  media: LocalMedia;
  /** Called when something happened that changes what the page should show (e.g. we were removed). */
  onNeedRefresh: () => void;
}

/**
 * Connects to LiveKit and publishes the pre-made camera/mic tracks when — and only when — the server says canPublish.
 *
 * Two independent safety layers:
 *  - the browser only TRIES to publish when its clock says "on air" AND it holds the publish permission;
 *  - the LiveKit server only ACCEPTS publishing from a participant the worker has granted (the real enforcement).
 * A modified browser can skip the first layer but can never get past the second.
 */
export function useLiveRoom({ slug, wantConnection, wantPublish, media, onNeedRefresh }: Options) {
  const [conn, setConn] = useState<RoomConn>("idle");
  const [canPublish, setCanPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [quality, setQuality] = useState<string>("unknown");
  const [replaced, setReplaced] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [epoch, setEpoch] = useState(0);

  const roomRef = useRef<Room | null>(null);
  const busyRef = useRef(false);
  const wasAllowedRef = useRef(false);
  const mediaRef = useRef(media);
  const wantPublishRef = useRef(wantPublish);
  const refreshRef = useRef(onNeedRefresh);
  /** Retry delay for failed connection attempts: 3 s, doubling up to 20 s, so an outage never hammers our API. */
  const backoffRef = useRef(3000);
  // Keep the refs current. Declared first, so they are up to date before the effects below run.
  useEffect(() => {
    mediaRef.current = media;
    wantPublishRef.current = wantPublish;
    refreshRef.current = onNeedRefresh;
  });

  /** Make "what is published" match "what we should publish". Safe to call as often as we like. */
  const reconcile = useCallback(async () => {
    const room = roomRef.current;
    if (!room || room.state !== ConnectionState.Connected || busyRef.current) return;
    busyRef.current = true;
    try {
      const lp = room.localParticipant;
      const allowed = !!lp.permissions?.canPublish;
      setCanPublish(allowed);
      // The server just let us go on air (e.g. ops pressed "skip"): re-read the schedule NOW instead of waiting for the next poll.
      if (allowed && !wasAllowedRef.current) refreshRef.current();
      wasAllowedRef.current = allowed;
      const cam = lp.getTrackPublication(Track.Source.Camera);
      const mic = lp.getTrackPublication(Track.Source.Microphone);
      const { video, audio } = mediaRef.current;

      if (allowed && wantPublishRef.current) {
        if (video && cam?.track !== video) await lp.publishTrack(video, videoPublishOptions);
        if (audio && mic?.track !== audio) await lp.publishTrack(audio, audioPublishOptions);
        setPublishing(!!video || !!audio);
      } else {
        // stopOnUnpublish = false keeps the camera alive locally (green room preview) while nothing is sent.
        if (cam?.track) await lp.unpublishTrack(cam.track, false);
        if (mic?.track) await lp.unpublishTrack(mic.track, false);
        setPublishing(false);
      }
    } catch (e) {
      console.warn("[live] publish reconcile failed:", e instanceof Error ? e.message : e);
    } finally {
      busyRef.current = false;
    }
  }, []);

  // Connect / disconnect.
  useEffect(() => {
    if (!wantConnection || replaced) return;
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let room: Room | null = null;

    const nextBackoff = () => {
      const d = backoffRef.current;
      backoffRef.current = Math.min(20_000, d * 2);
      return d;
    };

    const connect = async () => {
      if (cancelled) return;
      setConn("connecting");
      try {
        const res = await fetch("/api/live/token", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug }),
        });
        if (cancelled) return;
        if (!res.ok) {
          // 403: not allowed (yet / any more). 429: slow down. Either way ask the page to re-check, then try again.
          setError(res.status === 403 ? "outside_window" : "token_failed");
          refreshRef.current();
          retry = setTimeout(connect, nextBackoff());
          return;
        }
        const { token, url } = (await res.json()) as { token: string; url: string };
        room = new Room({
          adaptiveStream: false, // we only publish; nothing to adapt
          dynacast: false,
          // IMPORTANT: by default the SDK STOPS a local track whenever it is unpublished (for example when the server revokes
          // permission or the connection is lost). We keep the camera warm on purpose, so we manage that ourselves.
          stopLocalTrackOnUnpublish: false,
          publishDefaults: { simulcast: false, videoCodec: videoPublishOptions.videoCodec },
        });
        room
          .on(RoomEvent.Reconnecting, () => setConn("reconnecting"))
          .on(RoomEvent.Reconnected, () => {
            setConn("connected");
            void reconcile(); // after a reconnect, make sure we are publishing again
          })
          .on(RoomEvent.ConnectionQualityChanged, (q, p) => {
            if (p.isLocal) setQuality(q === ConnectionQuality.Unknown ? "unknown" : String(q));
          })
          .on(RoomEvent.ParticipantPermissionsChanged, (_prev, p) => {
            if (p.isLocal) void reconcile(); // <- this is the moment we go on air (or off air)
          })
          .on(RoomEvent.Disconnected, (reason) => {
            if (cancelled || reason === DisconnectReason.CLIENT_INITIATED) return;
            setPublishing(false);
            setCanPublish(false);
            if (reason === DisconnectReason.DUPLICATE_IDENTITY) {
              // Same link opened elsewhere: newest connection wins. Do not fight it.
              setReplaced(true);
              setConn("disconnected");
              return;
            }
            setConn("disconnected");
            refreshRef.current();
            retry = setTimeout(() => setEpoch((e) => e + 1), 3000);
          });

        await room.connect(url, token, { autoSubscribe: false });
        if (cancelled) {
          void room.disconnect(false);
          return;
        }
        roomRef.current = room;
        backoffRef.current = 3000;
        setError(null);
        setConn("connected");
        void reconcile(); // we may already have been granted publish (page reloaded mid-shift)
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "connect_failed");
        room?.disconnect(false).catch(() => {});
        retry = setTimeout(connect, nextBackoff());
      }
    };

    void connect();
    return () => {
      cancelled = true;
      clearTimeout(retry);
      roomRef.current = null;
      void room?.disconnect(false);
      setConn("idle");
      setCanPublish(false);
      setPublishing(false);
    };
  }, [wantConnection, slug, epoch, replaced, reconcile]);

  // Re-check whenever the wish or the tracks change, plus a slow safety net.
  useEffect(() => {
    void reconcile();
  }, [wantPublish, media.video, media.audio, conn, reconcile]);
  useEffect(() => {
    const id = setInterval(() => void reconcile(), 2000);
    return () => clearInterval(id);
  }, [reconcile]);

  // Health report for the ops diagnostics panel, every 5 seconds.
  useEffect(() => {
    if (conn !== "connected" && conn !== "reconnecting") return;
    let lastBytes = 0;
    let lastTs = 0;
    const id = setInterval(async () => {
      let rttMs: number | null = null;
      let uplinkKbps: number | null = null;
      let fps: number | null = null;
      let width: number | null = null;
      let height: number | null = null;
      let limitation: string | null = null;
      try {
        const stats = await mediaRef.current.video?.getSenderStats();
        const s = stats?.[0];
        if (s) {
          fps = s.framesPerSecond ?? null;
          width = s.frameWidth ?? null;
          height = s.frameHeight ?? null;
          limitation = s.qualityLimitationReason && s.qualityLimitationReason !== "none" ? s.qualityLimitationReason : null;
          rttMs = s.roundTripTime != null ? Math.round(s.roundTripTime * 1000) : null;
          if (s.bytesSent != null && lastTs && s.timestamp > lastTs) {
            uplinkKbps = Math.round(((s.bytesSent - lastBytes) * 8) / (s.timestamp - lastTs));
          }
          lastBytes = s.bytesSent ?? 0;
          lastTs = s.timestamp;
        }
      } catch {
        /* stats are optional */
      }
      fetch("/api/live/heartbeat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        keepalive: true,
        body: JSON.stringify({
          slug,
          phase: wantPublishRef.current ? "onair" : "greenroom",
          quality,
          rttMs,
          uplinkKbps,
          fps,
          width,
          height,
          limitation,
          connection: roomRef.current?.state ?? "unknown",
          publishing: !!roomRef.current?.localParticipant.getTrackPublication(Track.Source.Camera)?.track,
        }),
      }).catch(() => {});
    }, 5000);
    return () => clearInterval(id);
  }, [conn, slug, quality]);

  const takeOverAgain = useCallback(() => {
    setReplaced(false);
    setEpoch((e) => e + 1);
  }, []);

  return { conn, canPublish, publishing, quality, replaced, error, takeOverAgain };
}

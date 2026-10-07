"use client";

import { useEffect, useRef, useState } from "react";
import { ParticipantKind, Room, RoomEvent, Track, type RemoteAudioTrack, type RemoteVideoTrack } from "livekit-client";
import { EMPTY_METADATA, parseRoomMetadata, type RoomMetadata } from "@/lib/schedule/roomMetadata";

/**
 * THE PICTURE THAT GOES TO INSTAGRAM.
 *
 * LiveKit's egress opens this page in a hidden Chrome window sized 720x1280 and records what it sees and hears. We tell it when
 * to start by printing START_RECORDING to the console (that is LiveKit's documented signal). We NEVER print END_RECORDING during
 * normal operation: that would end the stream. (LiveKit's own helper library prints it whenever the room disconnects, which is
 * why we do not use that part of it.) Hand-offs, silence and transition videos all happen inside this one running page.
 *
 * WHAT IT SHOWS is decided by ROOM METADATA written by our worker (see src/lib/schedule/roomMetadata.ts):
 *   - normal:        the on-air astrologer's video (cropped to portrait) + audio, and NOTHING drawn on top of it
 *                    (no name, no tagline, no "Next:" strip, no logo — removed on request)
 *   - transition:    looping transition video + its audio  (ops switch, or nobody scheduled, or the on-air person is not connected)
 *   - connecting:    a plain dark screen while the on-air person's camera is not sending yet (or is switched off)
 *
 * SAFETY: only the participant whose identity equals metadata.onAirIdentity is ever subscribed to / shown / heard. Everyone else
 * is ignored here even if something went wrong with permissions on the server.
 *
 * PERFORMANCE: this page shares a CPU with the video encoder. So: plain CSS, no canvas, no animation libraries, no big images.
 */

// ---- design constants (everything is in pixels of the fixed 720x1280 stage) -------------------------------------
const STAGE_W = 720;
const STAGE_H = 1280;
const LOGO_URL = "/brand/logo.svg";

type Demo = "onair" | "transition" | "connecting" | "empty" | null;

export function EgressLayout() {
  const [meta, setMeta] = useState<RoomMetadata>(EMPTY_METADATA);
  const [present, setPresent] = useState(false);
  const [video, setVideo] = useState<RemoteVideoTrack | null>(null);
  const [audio, setAudio] = useState<RemoteAudioTrack | null>(null);
  const [camMuted, setCamMuted] = useState(false);
  const [scale, setScale] = useState(1);
  const [missingParams, setMissingParams] = useState(false);
  const [demo, setDemo] = useState<Demo>(null);

  const videoEl = useRef<HTMLVideoElement>(null);
  const audioEl = useRef<HTMLAudioElement>(null);
  const transitionEl = useRef<HTMLVideoElement>(null);
  const [transitionBroken, setTransitionBroken] = useState(false);

  // Fit the fixed 720x1280 stage to whatever window we are in (exactly 1.0 inside the egress).
  useEffect(() => {
    const fit = () => setScale(Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);

  // ---- connect to LiveKit --------------------------------------------------------------------------------------
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const d = q.get("demo") as Demo;
    if (d) {
      // Visual test mode for designers/ops: no LiveKit, no START_RECORDING.
      setDemo(d);
      setMeta({
        ...EMPTY_METADATA,
        onAirIdentity: d === "empty" || d === "transition" ? null : "demo",
        onAirName: "Pandit Ravi Shankar",
        onAirTagline: "Vedic Astrologer",
        nextName: "Meera Joshi",
        nextStartsAt: new Date(Date.now() + 25 * 60_000).toISOString(),
        transition: d === "transition",
      });
      setPresent(d === "onair" || d === "connecting");
      return;
    }

    const url = q.get("url");
    const token = q.get("token");
    if (!url || !token) {
      setMissingParams(true);
      return;
    }

    let cancelled = false;
    let room: Room | null = null;
    let started = false;
    let failures = 0;

    const sync = (r: Room) => {
      const m = parseRoomMetadata(r.metadata);
      setMeta(m);
      let isPresent = false;
      let v: RemoteVideoTrack | null = null;
      let a: RemoteAudioTrack | null = null;
      let muted = false;

      for (const p of r.remoteParticipants.values()) {
        if (p.kind !== ParticipantKind.STANDARD) continue;
        // THE rule: only the on-air identity (and only when not in transition mode) is subscribed. Everyone else: nothing.
        const wanted = !!m.onAirIdentity && !m.transition && p.identity === m.onAirIdentity;
        for (const pub of p.trackPublications.values()) {
          const ok = wanted && (pub.source === Track.Source.Camera || pub.source === Track.Source.Microphone);
          if (pub.isSubscribed !== ok) pub.setSubscribed(ok);
        }
        if (wanted) {
          isPresent = true;
          const cam = p.getTrackPublication(Track.Source.Camera);
          const mic = p.getTrackPublication(Track.Source.Microphone);
          v = cam?.isSubscribed ? ((cam.videoTrack as RemoteVideoTrack | undefined) ?? null) : null;
          a = mic?.isSubscribed ? ((mic.audioTrack as RemoteAudioTrack | undefined) ?? null) : null;
          muted = !!cam?.isMuted;
        }
      }
      // identity present (even if transition is on) matters for the "connecting" vs "not here" decision
      if (m.transition) isPresent = [...r.remoteParticipants.values()].some((p) => p.identity === m.onAirIdentity);
      setPresent(isPresent);
      setVideo(v);
      setAudio(a);
      setCamMuted(muted);
    };

    const connect = async () => {
      if (cancelled) return;
      const r = new Room({ adaptiveStream: false, dynacast: false });
      room = r;
      const resync = () => sync(r);
      r.on(RoomEvent.RoomMetadataChanged, resync)
        .on(RoomEvent.ParticipantConnected, resync)
        .on(RoomEvent.ParticipantDisconnected, resync)
        .on(RoomEvent.TrackPublished, resync)
        .on(RoomEvent.TrackUnpublished, resync)
        .on(RoomEvent.TrackSubscribed, resync)
        .on(RoomEvent.TrackUnsubscribed, resync)
        .on(RoomEvent.TrackMuted, resync)
        .on(RoomEvent.TrackUnmuted, resync)
        .on(RoomEvent.Reconnected, resync)
        .on(RoomEvent.Disconnected, () => {
          if (cancelled) return;
          // LiveKit already tried to resume. Make a few fresh attempts; only if ALL fail do we end the recording, so ops
          // see a red alert instead of an Instagram stream silently frozen on its last frame.
          failures++;
          if (failures > 5) {
            console.log("END_RECORDING");
            return;
          }
          setTimeout(connect, 2000);
        });
      try {
        await r.connect(url, token, { autoSubscribe: false });
        if (cancelled) return void r.disconnect();
        failures = 0;
        sync(r);
        if (!started) {
          started = true;
          // Wait one paint so the very first frame LiveKit records is already our real layout, not a blank page.
          requestAnimationFrame(() => requestAnimationFrame(() => console.log("START_RECORDING")));
        }
      } catch {
        failures++;
        if (failures > 5) {
          console.log("END_RECORDING");
          return;
        }
        setTimeout(connect, 2000);
      }
    };
    void connect();

    return () => {
      cancelled = true;
      void room?.disconnect();
    };
  }, []);

  // ---- attach media to elements -------------------------------------------------------------------------------
  useEffect(() => {
    const el = videoEl.current;
    if (!el || !video) return;
    video.attach(el);
    return () => {
      video.detach(el);
    };
  }, [video]);

  useEffect(() => {
    const el = audioEl.current;
    if (!el || !audio) return;
    audio.attach(el);
    return () => {
      audio.detach(el);
    };
  }, [audio]);

  const showTransition = demo === "transition" || demo === "empty" || meta.transition || !meta.onAirIdentity || !present;

  // If the transition video file is missing or unplayable, show the built-in branded card instead of a black screen.
  // We cannot rely on onError alone: the browser may report the failure while the page is still loading, before React
  // has attached the handler. So we also look at the element's state once it is mounted, and again a little later.
  useEffect(() => {
    const el = transitionEl.current;
    if (!el) return;
    setTransitionBroken(false);
    const check = () => {
      if (el.error || el.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) setTransitionBroken(true);
    };
    check();
    const timers = [setTimeout(check, 800), setTimeout(check, 3000)];
    return () => timers.forEach(clearTimeout);
  }, [meta.transitionUrl]);

  // Play the transition video only while it is on screen (saves CPU the rest of the time). Try with sound first;
  // if the browser refuses to autoplay with sound, fall back to muted so the picture at least plays.
  useEffect(() => {
    const el = transitionEl.current;
    if (!el) return;
    if (showTransition) {
      el.muted = false;
      el.play().catch(() => {
        el.muted = true;
        el.play().catch(() => {});
      });
    } else {
      el.pause();
    }
  }, [showTransition, meta.transitionUrl]);

  // The on-air person's audio, silenced when ops press "Mute on-air astrologer".
  useEffect(() => {
    if (audioEl.current) audioEl.current.muted = meta.muted;
  }, [meta.muted, audio]);

  if (missingParams) {
    return <main style={{ padding: 24, color: "#aaa", fontFamily: "sans-serif" }}>This page is used by the Astrotalk stream. There is nothing to see here.</main>;
  }

  const hasPicture = !!video && !camMuted && !showTransition;

  return (
    <div style={{ position: "fixed", inset: 0, background: "#000", overflow: "hidden" }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          width: STAGE_W,
          height: STAGE_H,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          overflow: "hidden",
          background: "#0b0d12",
          fontFamily: "Arial, Helvetica, sans-serif",
        }}
      >
        {/* Transition video: always mounted so switching to it is instant; plays only while visible. */}
        <video
          ref={transitionEl}
          src={meta.transitionUrl}
          loop
          playsInline
          preload="auto"
          onError={() => setTransitionBroken(true)}
          onLoadedData={() => setTransitionBroken(false)}
          style={{ position: "absolute", inset: 0, width: STAGE_W, height: STAGE_H, objectFit: "cover", display: showTransition && !transitionBroken ? "block" : "none" }}
        />
        {showTransition && transitionBroken && <BrandCard title="We will be right back" subtitle="Astrotalk Live" />}

        {/* The on-air astrologer */}
        {!showTransition && (
          <>
            <video
              ref={videoEl}
              autoPlay
              playsInline
              muted
              style={{ position: "absolute", inset: 0, width: STAGE_W, height: STAGE_H, objectFit: "cover", objectPosition: "center 35%", display: hasPicture ? "block" : "none" }}
            />
            {/* While the camera is starting or switched off: a plain dark screen. No logo, no name, no text. */}
            {!hasPicture && (demo === "onair" ? <DemoPicture /> : <div style={{ position: "absolute", inset: 0, background: "#0b0d12" }} />)}
            <audio ref={audioEl} autoPlay />
          </>
        )}
      </div>
    </div>
  );
}

function BrandCard({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: "radial-gradient(circle at 50% 35%, #3b2f8f 0%, #151236 55%, #0b0d12 100%)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        color: "#fff",
        padding: 48,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO_URL} alt="" width={300} height={90} style={{ marginBottom: 48 }} />
      <div style={{ fontSize: 54, fontWeight: 700 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 32, color: "#cfc8ff", marginTop: 14 }}>{subtitle}</div>}
    </div>
  );
}

/** Stand-in for a camera picture in ?demo=onair, so the overlay can be checked visually. */
function DemoPicture() {
  return <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, #6b7a99 0%, #3b4560 60%, #232a3d 100%)" }} />;
}


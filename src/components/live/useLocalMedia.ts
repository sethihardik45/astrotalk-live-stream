"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createLocalAudioTrack, createLocalVideoTrack, type LocalAudioTrack, type LocalVideoTrack } from "livekit-client";
import { audioCaptureOptions, videoCaptureOptions } from "./capture";

export type MediaStatus = "idle" | "starting" | "ready" | "denied" | "nodevice" | "error";

export interface LocalMedia {
  status: MediaStatus;
  video: LocalVideoTrack | null;
  audio: LocalAudioTrack | null;
  cams: MediaDeviceInfo[];
  mics: MediaDeviceInfo[];
  camId: string;
  micId: string;
  micMuted: boolean;
  camOff: boolean;
  /** microphone loudness 0..1 for the level meter */
  level: number;
  start: () => Promise<void>;
  stop: () => void;
  setCam: (id: string) => Promise<void>;
  setMic: (id: string) => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleCam: () => Promise<void>;
}

/**
 * Owns the camera and microphone tracks. Tracks are created EARLY (in the waiting room / green room) and kept alive,
 * so when the server grants publish permission we can publish them instantly — no multi-second camera start-up on air.
 * Until then they are purely local: nothing is sent to any server.
 */
export function useLocalMedia(): LocalMedia {
  const [status, setStatus] = useState<MediaStatus>("idle");
  const [video, setVideo] = useState<LocalVideoTrack | null>(null);
  const [audio, setAudio] = useState<LocalAudioTrack | null>(null);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamIdState] = useState("");
  const [micId, setMicIdState] = useState("");
  const [micMuted, setMicMuted] = useState(false);
  const [camOff, setCamOff] = useState(false);
  const [level, setLevel] = useState(0);
  const videoRef = useRef<LocalVideoTrack | null>(null);
  const audioRef = useRef<LocalAudioTrack | null>(null);

  const refreshDevices = useCallback(async () => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      setCams(all.filter((d) => d.kind === "videoinput" && d.deviceId));
      setMics(all.filter((d) => d.kind === "audioinput" && d.deviceId));
    } catch {
      /* ignore */
    }
  }, []);

  const stop = useCallback(() => {
    videoRef.current?.stop();
    audioRef.current?.stop();
    videoRef.current = null;
    audioRef.current = null;
    setVideo(null);
    setAudio(null);
    setLevel(0);
    setStatus("idle");
  }, []);

  const start = useCallback(async () => {
    if (videoRef.current || audioRef.current) return;
    setStatus("starting");
    const [v, a] = await Promise.allSettled([
      createLocalVideoTrack(videoCaptureOptions()),
      createLocalAudioTrack(audioCaptureOptions),
    ]);
    const failure = [v, a].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (failure || v.status !== "fulfilled" || a.status !== "fulfilled") {
      // release whichever half did work, so a retry starts clean
      if (v.status === "fulfilled") v.value.stop();
      if (a.status === "fulfilled") a.value.stop();
      const name = (failure?.reason as { name?: string } | undefined)?.name ?? "";
      setStatus(name === "NotAllowedError" || name === "SecurityError" ? "denied" : name === "NotFoundError" ? "nodevice" : "error");
      return;
    }
    videoRef.current = v.value;
    audioRef.current = a.value;
    setVideo(v.value);
    setAudio(a.value);
    setCamIdState(v.value.mediaStreamTrack.getSettings().deviceId ?? "");
    setMicIdState(a.value.mediaStreamTrack.getSettings().deviceId ?? "");
    setMicMuted(false);
    setCamOff(false);
    setStatus("ready");
    await refreshDevices(); // device names are only available after permission is granted
  }, [refreshDevices]);

  // A track can die without telling us (device unplugged, another app grabbed the camera, or the LiveKit library stopped it).
  // Check every 2 seconds; if one has ended, restart both. Permission is already granted, so this needs no prompt.
  const restarting = useRef(false);
  useEffect(() => {
    if (!video && !audio) return;
    const id = setInterval(async () => {
      const dead = [videoRef.current, audioRef.current].some((t) => t && t.mediaStreamTrack.readyState === "ended");
      if (!dead || restarting.current) return;
      restarting.current = true;
      stop();
      await start(); // on failure the status becomes "error" and the page shows the restart button
      restarting.current = false;
    }, 2000);
    return () => clearInterval(id);
  }, [video, audio, stop, start]);

  useEffect(() => {
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
  }, [refreshDevices]);

  // Microphone level meter (purely local).
  useEffect(() => {
    if (!audio) return;
    let raf = 0;
    let last = 0;
    const Ctx: typeof AudioContext = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    ctx.resume().catch(() => {});
    const src = ctx.createMediaStreamSource(new MediaStream([audio.mediaStreamTrack]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.fftSize);
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 70) return; // ~14 updates a second is plenty
      last = t;
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (const b of buf) {
        const x = (b - 128) / 128;
        sum += x * x;
      }
      setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 3.5));
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      src.disconnect();
      ctx.close().catch(() => {});
    };
  }, [audio]);

  const setCam = useCallback(async (id: string) => {
    await videoRef.current?.setDeviceId(id);
    setCamIdState(id);
  }, []);
  const setMic = useCallback(async (id: string) => {
    await audioRef.current?.setDeviceId(id);
    setMicIdState(id);
  }, []);
  const toggleMic = useCallback(async () => {
    const t = audioRef.current;
    if (!t) return;
    if (t.isMuted) await t.unmute();
    else await t.mute();
    setMicMuted(t.isMuted);
  }, []);
  const toggleCam = useCallback(async () => {
    const t = videoRef.current;
    if (!t) return;
    if (t.isMuted) await t.unmute();
    else await t.mute();
    setCamOff(t.isMuted);
  }, []);

  // Release the camera light when leaving the page.
  useEffect(() => () => {
    videoRef.current?.stop();
    audioRef.current?.stop();
  }, []);

  return { status, video, audio, cams, mics, camId, micId, micMuted, camOff, level, start, stop, setCam, setMic, toggleMic, toggleCam };
}

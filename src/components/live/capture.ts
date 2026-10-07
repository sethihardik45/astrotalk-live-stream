import type { TrackPublishOptions } from "livekit-client";
import { Track } from "livekit-client";

/**
 * How the astrologer's camera and microphone are captured and published.
 * Tuning these is the main way to trade picture quality against bandwidth and CPU.
 *
 * WHY THESE VALUES
 *  - 1280x720 at 30 fps: good enough, and light for ordinary laptops and Wi-Fi. NOTE: the Instagram picture is a
 *    portrait 9:16 crop of the middle of this frame, so a landscape 720p camera gives about 405 pixels of width that get
 *    scaled up. If your astrologers have good webcams and wired internet, raise LANDSCAPE to 1920x1080 and
 *    VIDEO_MAX_BITRATE to 4_000_000 for a visibly sharper stream. On phones held upright we capture portrait 720x1280.
 *  - ONE video layer (simulcast = false): the only "viewer" of this video is our egress (the server that builds the
 *    Instagram picture). Extra layers would waste the astrologer's upload and CPU for no benefit.
 *  - Codec: VP8. It decodes everywhere, including the headless Chrome inside LiveKit's egress, and does not depend on
 *    hardware encoders. H.264 can use the GPU on some machines but behaves less consistently across browsers.
 *    If you want to experiment, change VIDEO_CODEC to "h264" and compare the stream.
 *  - Audio: Opus (always, in WebRTC) with echo cancellation, noise suppression and auto gain on.
 */
export const LANDSCAPE = { width: 1280, height: 720 } as const;
export const PORTRAIT = { width: 720, height: 1280 } as const;
export const FRAME_RATE = 30;
export const VIDEO_CODEC = "vp8" as const;
export const VIDEO_MAX_BITRATE = 2_500_000; // bits per second
export const AUDIO_MAX_BITRATE = 64_000;

export function pickResolution() {
  if (typeof window === "undefined") return LANDSCAPE;
  const isPhone = /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  const portrait = window.innerHeight > window.innerWidth;
  return isPhone && portrait ? PORTRAIT : LANDSCAPE;
}

export const videoCaptureOptions = () => {
  const r = pickResolution();
  return { resolution: { width: r.width, height: r.height, frameRate: FRAME_RATE } };
};

export const audioCaptureOptions = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
} as const;

export const videoPublishOptions: TrackPublishOptions = {
  source: Track.Source.Camera,
  simulcast: false,
  videoCodec: VIDEO_CODEC,
  videoEncoding: { maxBitrate: VIDEO_MAX_BITRATE, maxFramerate: FRAME_RATE },
  // When the network struggles, lower the resolution before lowering the frame rate (keeps motion smooth).
  degradationPreference: "maintain-framerate",
};

export const audioPublishOptions: TrackPublishOptions = {
  source: Track.Source.Microphone,
  audioPreset: { maxBitrate: AUDIO_MAX_BITRATE },
  dtx: true,
  red: true,
};

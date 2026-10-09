import { useEffect, useRef, useState } from "react";
import { LiveFaceGuidanceControllerV1 } from "../walkthrough/live-face-guidance";

/** Local framing guidance only. No camera data enters synthetic staging issuance. */
export function CameraPreview() {
  const video = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState("Starting your camera…");
  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | undefined;
    const guidance = new LiveFaceGuidanceControllerV1(() => video.current, result => {
      setMessage(result.code === "unavailable" ? "Face guidance is unavailable. The preview is still local." : result.text);
    });
    const stop = () => {
      stopped = true;
      guidance.stop();
      stream?.getTracks().forEach(track => track.stop());
      if (video.current) video.current.srcObject = null;
    };
    const hide = () => { if (document.visibilityState === "hidden") { stop(); setMessage("Camera stopped. Reopen the preview to continue."); } };
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", stop);
    void (async () => {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera API unavailable");
        const media = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
        stream = media;
        if (stopped || !video.current) { media.getTracks().forEach(track => track.stop()); return; }
        video.current.srcObject = media;
        await video.current.play();
        if (!stopped) guidance.start();
      })().catch(() => {
        stream?.getTracks().forEach(track => track.stop());
        if (!stopped) setMessage("Camera unavailable. Allow camera access, then reopen the preview.");
      });
    return () => {
      document.removeEventListener("visibilitychange", hide);
      window.removeEventListener("pagehide", stop);
      stop();
    };
  }, []);
  return <section className="camera-preview" aria-label="Local camera preview">
    <div className="camera-oval">
      <video ref={video} autoPlay playsInline muted aria-label="Your camera preview" />
      <img src="/assets/figma/capture-ring-ready.svg" alt="" />
    </div>
    <p role="status">{message}</p>
    <p className="detail-copy">Framing preview only. Images stay in this browser; the staging issuer uses synthetic input.</p>
  </section>;
}

import { useEffect, useRef, useState } from "react";
import { startFaceDetector } from "../face/face-detector";
import { faceGuidance } from "../face/rgbnet";

/** Local framing guidance only. No camera data enters synthetic staging issuance. */
export function CameraPreview() {
  const video = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState("Starting your camera…");
  const [detectorStatus, setDetectorStatus] = useState("");
  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | undefined;
    const detector = new AbortController();
    let candidate = "";
    let consecutive = 0;
    const stop = () => {
      stopped = true;
      detector.abort();
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
        if (!stopped) {
          setMessage("Loading face detector…");
          startFaceDetector(video.current, detector.signal, false,
            (faces, width, height) => {
              if (stopped || !video.current) return;
              const next = faceGuidance(faces, width, height, video.current.clientWidth, video.current.clientHeight);
              consecutive = next === candidate ? consecutive + 1 : 1;
              candidate = next;
              if (consecutive >= 2) setMessage(next);
            },
            status => { if (!stopped) setDetectorStatus(status); },
            failure => { if (!stopped) setMessage(`Face guidance unavailable: ${failure} Close and reopen the preview to retry.`); },
          );
        }
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
    <details><summary>ONNX processing status</summary><p className="detail-copy">{detectorStatus || "Waiting for camera frames."}</p></details>
    <p className="detail-copy">Framing preview only. Images stay in this browser; the staging issuer uses synthetic input.</p>
  </section>;
}

// FaceEngine head pose from biometric-engines-worker-v0.3.0, served from the public face-engine model CDN.
// The browser checks the size and SHA-256 after download.
export const HEAD_POSE_MODEL = {
  url: "https://wld-ml-face-engine-public.worldcoin.org/assets/models/HeadPose/bc47e4e2b0d83e0a5f5fa8bad2e3489f66753177/head_pose.onnx",
  bytes: 4_224_209,
  sha256: "93984c32dd8458e5bc34b0194f4480e2ce482be608223248da06edf27b3ac87d",
} as const;

export interface FigmaAssetProvenanceV1 {
  readonly localPath: `/assets/figma/${string}`;
  readonly nodeId: `5132:${number}`;
  readonly sourceUrl: `https://www.figma.com/api/mcp/asset/${string}`;
  readonly sha256: string;
  readonly purpose: string;
}

export const FIGMA_ASSET_PROVENANCE_V1 = Object.freeze([
  { localPath: "/assets/figma/person-key-blue.svg", nodeId: "5132:134394", sourceUrl: "https://www.figma.com/api/mcp/asset/07bcbe07-ecdb-415c-88db-2d594d91734e.svg", sha256: "01cbc96f0451a240374b3d040c7f66ef39cb2b23fef3aeaf4001b88cdb9a95d1", purpose: "Authenticator screen illustration" },
  { localPath: "/assets/figma/person-key-disabled.svg", nodeId: "5132:134441", sourceUrl: "https://www.figma.com/api/mcp/asset/d986c10a-7a07-4db7-ad52-0bc173b45ceb.svg", sha256: "c96d648958f4d1c03d290b48486380267a19e1c1e7d869b35277fb3bf6fc9c8c", purpose: "Authenticator error illustration" },
  { localPath: "/assets/figma/selfie-emblem.svg", nodeId: "5132:134643", sourceUrl: "https://www.figma.com/api/mcp/asset/0b0666f6-d7b3-4de1-860e-cc593dc71821.svg", sha256: "5afac7cfb0d8740e1902e303f884db20539e686b0781be5fe85e9b0c9a567c00", purpose: "Camera introduction illustration" },
  { localPath: "/assets/figma/capture-ring-ready.svg", nodeId: "5132:134743", sourceUrl: "https://www.figma.com/api/mcp/asset/0908f5e3-7a93-4156-9da1-e041e98d9163.svg", sha256: "1c8340a8110ddfc95e5b3ca2cf3815eb91166efbd57d8f4223384c2eb1403b6b", purpose: "Capture preview guide" },
  { localPath: "/assets/figma/capture-ring-sampling.svg", nodeId: "5132:134841", sourceUrl: "https://www.figma.com/api/mcp/asset/a408a986-a083-41fd-b0ef-d217a07e7b2c.svg", sha256: "ef82fd23789114651997a6f34c8c8ba4ca3945a337d692f8544847c82676c21b", purpose: "Capture sampling guide" },
  { localPath: "/assets/figma/capture-ring-complete.svg", nodeId: "5132:134939", sourceUrl: "https://www.figma.com/api/mcp/asset/3ffd0e27-110e-462c-9d66-eec1b9157bdf.svg", sha256: "5cc3dc23cb2f7e9de2126a38303017932a852ff600772647e63c5315d6412721", purpose: "Capture-complete guide" },
  { localPath: "/assets/figma/capture-check.svg", nodeId: "5132:134939", sourceUrl: "https://www.figma.com/api/mcp/asset/4d4f6ad4-9fe9-49fe-aaa3-6b3f9b867d88.svg", sha256: "b6383e100e675e7d80c869ce5137efddc87970a29bd34740b526f6ae0bec7e8c", purpose: "Capture-complete marker" },
  { localPath: "/assets/figma/simulation-progress.svg", nodeId: "5132:135038", sourceUrl: "https://www.figma.com/api/mcp/asset/4de20e04-08c1-4836-afd6-f525fbbb9b69.svg", sha256: "3ddb7b0615b908730d2d9698b11bb3230bceddeb1bbe49b673d60ad8784e664a", purpose: "Simulator pending illustration" },
  { localPath: "/assets/figma/verification-complete.svg", nodeId: "5132:135071", sourceUrl: "https://www.figma.com/api/mcp/asset/6ece6628-e2d6-4b43-9573-03acda2dfd61.svg", sha256: "da55efa462ccd970f7ca4b9e1f3682f6e69cb57a582a480fd53b5b8f9f1f9e7b", purpose: "Verification-complete illustration (ring fully blue)" },
  { localPath: "/assets/figma/success-emblem.svg", nodeId: "5132:135104", sourceUrl: "https://www.figma.com/api/mcp/asset/8d5d519c-4cec-449e-85b9-b2054d417f20.svg", sha256: "30b39383c0f2a68fc1a439adcae7f482bb089b9a5262663f90fc3a14580af8b0", purpose: "Proof of Presence success illustration" },
] as const satisfies readonly FigmaAssetProvenanceV1[]);

export const FIGMA_ASSET_PATHS_V1 = Object.freeze({
  personKeyBlue: "/assets/figma/person-key-blue.svg",
  personKeyDisabled: "/assets/figma/person-key-disabled.svg",
  selfieEmblem: "/assets/figma/selfie-emblem.svg",
  captureRingReady: "/assets/figma/capture-ring-ready.svg",
  captureRingSampling: "/assets/figma/capture-ring-sampling.svg",
  captureRingComplete: "/assets/figma/capture-ring-complete.svg",
  captureCheck: "/assets/figma/capture-check.svg",
  simulationProgress: "/assets/figma/simulation-progress.svg",
  verificationComplete: "/assets/figma/verification-complete.svg",
  successEmblem: "/assets/figma/success-emblem.svg",
} as const);

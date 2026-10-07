import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1,
  makeAuthenticatorUiSnapshotV1,
  type AuthenticatorUiActionV1,
  type AuthenticatorUiSnapshotV1,
} from "@clean-start/contracts";
import {
  HttpSimulatorBrowserSessionClientV0,
  type AbortableSimulatorBrowserSessionPortV0,
} from "./adapters/http-session";
import { openPasskeyWallet, type WalletSession } from "./wallet/session";
import { FlowScreenV1 } from "./components/FlowScreen";
import {
  AuthenticatorFlowControllerV1,
  type AuthenticatorFlowControllerOptionsV1,
} from "./flow/controller";
import {
  type LiveFaceGuidanceV1,
} from "./walkthrough/live-face-guidance";
import {
  CAPTURE_COMPLETE_ACK_MS_V1,
  captureHoldProgressV1,
} from "./walkthrough/hold-steady-progress";
import {
  type LivePasskeyResultV1,
  type LivePasskeyStatusV1,
} from "./walkthrough/live-passkey";
import {
  WALKTHROUGH_ACTION_LABELS_V1,
  WALKTHROUGH_COPY_V1,
  WALKTHROUGH_DETAIL_COPY_V1,
  WALKTHROUGH_DISCLOSURE_V1,
  WALKTHROUGH_PASSKEY_READY_COPY_V1,
  WALKTHROUGH_RETURNED_HERO_V1,
} from "./walkthrough/production-copy";
import {
  createLocalWalkthroughAdmissionAdapterV1,
  LocalWalkthroughCaptureAdapterV1,
  type WalkthroughCameraStatusV1,
} from "./walkthrough/walkthrough-adapters";

export interface AuthenticatorAppMediaV1 {
  readonly getVideo: () => HTMLVideoElement | null;
  readonly getCanvas: () => HTMLCanvasElement | null;
}

export interface AuthenticatorControllerRuntimeV1 {
  readonly onCameraStatus: (status: WalkthroughCameraStatusV1) => void;
  readonly onLiveGuidance: (guidance: LiveFaceGuidanceV1) => void;
}

export type AuthenticatorControllerFactoryV1 = (
  media: AuthenticatorAppMediaV1,
  initialSnapshot: AuthenticatorUiSnapshotV1,
  runtime?: AuthenticatorControllerRuntimeV1,
) => AuthenticatorFlowControllerV1;

// Every shell route runs the same live flow with the production presentation.
// `/demo` and `/demo/returned` are aliases of `/` and `/returned`, kept so
// existing links and evidence keep working.
const RETURNED_PATHS_V1: readonly string[] = Object.freeze(["/returned", "/demo/returned"]);

export function returnedPathForV1(pathname: string): "/returned" | "/demo/returned" {
  return pathname.startsWith("/demo") ? "/demo/returned" : "/returned";
}

export function initialAuthenticatorSnapshotV1(): AuthenticatorUiSnapshotV1 {
  const state = RETURNED_PATHS_V1.includes(window.location.pathname)
    ? "returned"
    : "request_checking";
  return makeAuthenticatorUiSnapshotV1({
    state,
    visualSource: AUTHENTICATOR_UI_DEFAULT_VISUAL_SOURCE_V1[state],
  });
}

const NO_RUNTIME_CALLBACKS_V1: AuthenticatorControllerRuntimeV1 = Object.freeze({
  onCameraStatus: (_status: WalkthroughCameraStatusV1): void => undefined,
  onLiveGuidance: (_guidance: LiveFaceGuidanceV1): void => undefined,
});

// Builds the controller factory for a given session port: the same-origin HTTP
// client for the served app, or the in-page simulator for the static demo build
// (`apps/authenticator/static-demo`). Admission, capture, and return handling are
// identical either way.
export function makeAuthenticatorControllerFactoryV1(
  sessionPort: AbortableSimulatorBrowserSessionPortV0,
): AuthenticatorControllerFactoryV1 {
  return (media, snapshot, runtime = NO_RUNTIME_CALLBACKS_V1) => {
    const options: AuthenticatorFlowControllerOptionsV1 = {
      sessionPort,
      admission: createLocalWalkthroughAdmissionAdapterV1(),
      capture: new LocalWalkthroughCaptureAdapterV1({
        getVideo: media.getVideo,
        getCanvas: media.getCanvas,
        onStatus: runtime.onCameraStatus,
        onGuidance: runtime.onLiveGuidance,
      }),
      initialSnapshot: snapshot,
      closeLocally: () => window.close(),
      navigateReturned: () => window.location.assign(
        returnedPathForV1(window.location.pathname),
      ),
    };
    return new AuthenticatorFlowControllerV1(options);
  };
}

export const createDefaultAuthenticatorControllerV1: AuthenticatorControllerFactoryV1 = (
  media,
  snapshot,
  runtime,
) => makeAuthenticatorControllerFactoryV1(new HttpSimulatorBrowserSessionClientV0())(
  media,
  snapshot,
  runtime,
);

// User actions that begin a fresh capture attempt reset the hold-steady ring.
const CAPTURE_RESTART_ACTIONS_V1: ReadonlySet<AuthenticatorUiActionV1> = new Set<AuthenticatorUiActionV1>([
  "continue_to_camera",
  "start_camera",
  "retake",
  "try_again",
  "continue_without_guidance",
]);

export function AuthenticatorAppV1({
  controllerFactory = createDefaultAuthenticatorControllerV1,
  createPasskey,
}: {
  readonly controllerFactory?: AuthenticatorControllerFactoryV1;
  readonly createPasskey?: () => Promise<LivePasskeyResultV1>;
}) {
  const walletRef = useRef<WalletSession | null>(null);
  const walletOpeningRef = useRef<AbortController | null>(null);
  const [walletError, setWalletError] = useState<string>();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const controllerRef = useRef<AuthenticatorFlowControllerV1 | null>(null);
  const initial = useMemo(() => initialAuthenticatorSnapshotV1(), []);
  const [snapshot, setSnapshot] = useState<AuthenticatorUiSnapshotV1>(initial);
  const [passkeyStatus, setPasskeyStatus] = useState<LivePasskeyStatusV1>("idle");
  const [cameraStatus, setCameraStatus] = useState<WalkthroughCameraStatusV1>("idle");
  const [liveGuidance, setLiveGuidance] = useState<LiveFaceGuidanceV1>();
  const [captureHoldProgress, setCaptureHoldProgress] = useState(0);
  const captureProgressFrameRef = useRef<number | undefined>(undefined);
  const captureCompleteTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const onLiveGuidance = useCallback((guidance: LiveFaceGuidanceV1): void => {
    setLiveGuidance(guidance);
    if (guidance.code !== "hold_steady") setCaptureHoldProgress(0);
  }, []);

  useEffect(() => {
    const controller = controllerFactory({
      getVideo: () => videoRef.current,
      getCanvas: () => canvasRef.current,
    }, initial, {
      onCameraStatus: setCameraStatus,
      onLiveGuidance,
    });
    controllerRef.current = controller;
    const unsubscribe = controller.subscribe(setSnapshot);
    const visibility = () => {
      if (document.visibilityState !== "visible") controller.interrupt("page_hidden");
    };
    const pagehide = () => {
      controller.interrupt("page_unloaded");
      walletOpeningRef.current?.abort();
      walletRef.current?.client.terminate();
      walletRef.current = null;
    };
    const orientation = () => controller.interrupt("orientation_invalidated");
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("orientationchange", orientation);
    controller.start();
    return () => {
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", pagehide);
      window.removeEventListener("orientationchange", orientation);
      unsubscribe();
      walletOpeningRef.current?.abort();
      walletRef.current?.client.terminate();
      walletRef.current = null;
      controller.dispose();
      controllerRef.current = null;
    };
  }, [controllerFactory, initial, onLiveGuidance]);

  // Two states advance on their own before they paint. Supported-browser
  // admission is answered locally, and the separate camera-intro screen is
  // folded into the passkey-created screen: its "Start selfie check" action
  // prepares the capture session, and the camera opens as soon as it is ready.
  useLayoutEffect(() => {
    if (
      snapshot.state === "admission_safari_candidate" ||
      snapshot.state === "admission_chrome_candidate"
    ) {
      controllerRef.current?.act("continue");
    }
    if (snapshot.state === "capture_intro") {
      controllerRef.current?.act("start_camera");
    }
  }, [snapshot.state]);

  useEffect(() => {
    if (
      cameraStatus !== "live" ||
      snapshot.state !== "capture_preview" ||
      liveGuidance?.code !== "hold_steady"
    ) return;
    const startedAt = performance.now();
    const tick = (now: number): void => {
      const progress = captureHoldProgressV1(now - startedAt);
      setCaptureHoldProgress(progress);
      if (progress < 1) {
        captureProgressFrameRef.current = requestAnimationFrame(tick);
        return;
      }
      captureCompleteTimerRef.current = setTimeout(() => {
        controllerRef.current?.act("collect_frame_metadata");
      }, CAPTURE_COMPLETE_ACK_MS_V1);
    };
    captureProgressFrameRef.current = requestAnimationFrame(tick);
    return () => {
      if (captureProgressFrameRef.current !== undefined) {
        cancelAnimationFrame(captureProgressFrameRef.current);
      }
      if (captureCompleteTimerRef.current !== undefined) {
        clearTimeout(captureCompleteTimerRef.current);
      }
      captureProgressFrameRef.current = undefined;
      captureCompleteTimerRef.current = undefined;
    };
  }, [cameraStatus, liveGuidance?.code, snapshot.state]);

  const onAction = (action: AuthenticatorUiActionV1): void => {
    if (action === "cancel" || action === "close") {
      walletOpeningRef.current?.abort();
      walletRef.current?.client.terminate();
      walletRef.current = null;
    }
    if (CAPTURE_RESTART_ACTIONS_V1.has(action)) setCaptureHoldProgress(0);
    if (action === "start_demo_authenticator" && passkeyStatus !== "requesting") {
      setPasskeyStatus("requesting");
      setWalletError(undefined);
      const opening = new AbortController();
      walletOpeningRef.current = opening;
      const unlock = async (): Promise<LivePasskeyResultV1> => {
        if (createPasskey !== undefined) return createPasskey();
        walletRef.current?.client.terminate();
        const session = await openPasskeyWallet(opening.signal);
        if (opening.signal.aborted) {
          session.client.terminate();
          opening.signal.throwIfAborted();
        }
        walletRef.current = session;
        return { status: "created", prfCapability: "available" };
      };
      void unlock().then((result) => {
        if (opening.signal.aborted) return;
        setPasskeyStatus(result.status);
        if (result.status === "created" && result.prfCapability === "available") {
          controllerRef.current?.act(action);
        } else {
          setWalletError("A PRF-capable passkey is required. Please try again.");
        }
      }).catch((error: unknown) => {
        if (opening.signal.aborted) return;
        setPasskeyStatus("failed");
        setWalletError(error instanceof DOMException && error.name === "NotAllowedError"
          ? "Passkey unlock was cancelled. Please try again."
          : "Could not unlock the wallet. Use a PRF-capable passkey and close other tabs using this wallet, then retry.");
      });
      return;
    }
    if (passkeyStatus === "requesting") return;
    controllerRef.current?.act(action);
  };

  const copyOverride = snapshot.state === "demo_authenticator_ready"
    ? WALKTHROUGH_PASSKEY_READY_COPY_V1[passkeyStatus === "created" ? "created" : "notCreated"]
    : WALKTHROUGH_COPY_V1[snapshot.state];
  return <>
    {walletError && <p role="alert" className="wallet-error">{walletError}</p>}
    <FlowScreenV1
    snapshot={snapshot}
    onAction={onAction}
    videoRef={videoRef}
    canvasRef={canvasRef}
    bannerText="Development preview · Biometric verification and credential issuance are simulated."
    copyOverride={copyOverride}
    detailCopyOverrides={WALKTHROUGH_DETAIL_COPY_V1}
    actionLabelOverrides={{
      ...WALKTHROUGH_ACTION_LABELS_V1,
      start_demo_authenticator: passkeyStatus === "requesting"
        ? "Waiting for browser…"
        : WALKTHROUGH_ACTION_LABELS_V1.start_demo_authenticator,
    }}
    actionsDisabled={passkeyStatus === "requesting"}
    disclosure={WALKTHROUGH_DISCLOSURE_V1}
    heroOverride={snapshot.state === "returned" ? WALKTHROUGH_RETURNED_HERO_V1 : undefined}
    showTemplateNotice={false}
    liveCaptureGuidance={liveGuidance}
    captureProgress={cameraStatus === "live" ? captureHoldProgress : undefined}
    hiddenActions={cameraStatus === "live" && liveGuidance?.code !== "unavailable"
      ? ["collect_frame_metadata"]
      : undefined}
  /></>;
}

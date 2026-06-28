"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PaymentResultDialog } from "@/app/components/PaymentResultDialog";
import { ProcessingOverlay } from "@/app/components/ProcessingOverlay";
import type {
  PaymentCreateFromFaceRequest,
  PaymentTransactionHash,
  PaymentVerify,
  SuccessResponse,
  Toast,
  VerifyStatus,
} from "@/app/types/payment";

type PaymentInput = {
  store_id: number;
  amount: number;
};

type FaceDetectorLike = {
  detect: (source: CanvasImageSource) => Promise<unknown[]>;
};

type FaceDetectorConstructor = new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => FaceDetectorLike;

declare global {
  interface Window {
    FaceDetector?: FaceDetectorConstructor;
  }
}

const api = process.env.NEXT_PUBLIC_TERAID_PAY_API ?? "http://localhost:8005";
const configuredRequiredFaceVisibleMs = Number(process.env.NEXT_PUBLIC_FACE_PAYMENT_REQUIRED_VISIBLE_MS);
const done = new Set<VerifyStatus>(["paid", "tx_failed", "verify_failed", "canceled", "error"]);
const toastDurationMs = 3000;
const maxBase64Length = 5000;
const requiredFaceVisibleMs =
  Number.isFinite(configuredRequiredFaceVisibleMs) && configuredRequiredFaceVisibleMs > 0 ? configuredRequiredFaceVisibleMs : 3000;
const faceFrameRatio = 0.72;

class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

function getApiErrorMessage(body: unknown) {
  if (
    typeof body === "object" &&
    body !== null &&
    "detail" in body &&
    typeof body.detail === "object" &&
    body.detail !== null &&
    "message" in body.detail &&
    typeof body.detail.message === "string"
  ) {
    return body.detail.message;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeCameraError(error: unknown, phase: string) {
  const name = error instanceof Error ? error.name : typeof error;
  const message = error instanceof Error ? error.message : String(error);
  return `${phase} failed: ${name}${message ? ` (${message})` : ""}`;
}

function isNotReadableError(error: unknown) {
  return error instanceof DOMException && error.name === "NotReadableError";
}

function waitForVideoMetadata(video: HTMLVideoElement) {
  if (video.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve();

  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      video.removeEventListener("loadedmetadata", handleLoaded);
      video.removeEventListener("error", handleError);
    };
    const handleLoaded = () => {
      cleanup();
      resolve();
    };
    const handleError = () => {
      cleanup();
      reject(video.error ?? Error("video metadata is unavailable"));
    };

    video.addEventListener("loadedmetadata", handleLoaded, { once: true });
    video.addEventListener("error", handleError, { once: true });
  });
}

async function openCamera() {
  const constraints: MediaStreamConstraints[] = [
    { video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } }, audio: false },
    { video: true, audio: false },
  ];
  let lastError: unknown;

  for (const constraint of constraints) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraint);
      } catch (error) {
        lastError = error;
        if (!isNotReadableError(error)) throw error;
        await sleep(500 * (attempt + 1));
      }
    }
  }

  throw lastError;
}

function stripDataUrlPrefix(dataUrl: string) {
  return dataUrl.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/, "");
}

function getFaceFrameSourceRect(video: HTMLVideoElement) {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  const visibleSourceSize = Math.min(sourceWidth, sourceHeight);
  const visibleSourceX = Math.max(0, (sourceWidth - visibleSourceSize) / 2);
  const visibleSourceY = Math.max(0, (sourceHeight - visibleSourceSize) / 2);
  const frameSourceSize = visibleSourceSize * faceFrameRatio;

  return {
    x: visibleSourceX + (visibleSourceSize - frameSourceSize) / 2,
    y: visibleSourceY + (visibleSourceSize - frameSourceSize) / 2,
    size: frameSourceSize,
  };
}

function drawFaceFrame(video: HTMLVideoElement, size: number, quality?: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw Error("canvas context is unavailable");

  const frame = getFaceFrameSourceRect(video);
  ctx.drawImage(video, frame.x, frame.y, frame.size, frame.size, 0, 0, size, size);
  return quality === undefined ? canvas : stripDataUrlPrefix(canvas.toDataURL("image/jpeg", quality));
}

function drawVideoFrame(video: HTMLVideoElement, size: number, quality: number) {
  return drawFaceFrame(video, size, quality) as string;
}

function captureCompressedBase64(video: HTMLVideoElement) {
  const sizes = [160, 128, 112, 96, 80, 64, 48, 40, 32];
  const qualities = [0.8, 0.7, 0.6, 0.5, 0.4, 0.32, 0.24, 0.18, 0.12];

  for (const size of sizes) {
    for (const quality of qualities) {
      const content = drawVideoFrame(video, size, quality);
      if (content.length <= maxBase64Length) return content;
    }
  }

  throw Error("face image is too large");
}

export default function FacePaymentPage() {
  const [paymentInput, setPaymentInput] = useState<PaymentInput>();
  const [toast, setToast] = useState<Toast>();
  const [processing, setProcessing] = useState(false);
  const [cameraError, setCameraError] = useState<string>();
  const [cameraReady, setCameraReady] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | undefined>(undefined);
  const cancelled = useRef(false);
  const submitting = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    cancelled.current = false;
    return () => {
      cancelled.current = true;
      clearTimeout(toastTimer.current);
      stopCamera();
    };
  }, []);

  const json = useCallback(async function json<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${api}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = getApiErrorMessage(body);
      if (message) throw new ApiError(message);
      throw Error(`HTTP ${res.status}`);
    }
    return body;
  }, []);

  const showToast = useCallback((next: Toast) => {
    clearTimeout(toastTimer.current);
    setToast(next);
    toastTimer.current = setTimeout(() => setToast(undefined), toastDurationMs);
  }, []);

  const pollUntilDone = useCallback(async (id: number) => {
    while (!cancelled.current) {
      const { data } = await json<SuccessResponse<PaymentVerify>>(`/payment/request/${id}/verify`, { method: "POST" });
      if (done.has(data.status)) return data.status;
      await sleep(3000);
    }
    throw Error("cancelled");
  }, [json]);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;

    const video = videoRef.current;
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  }

  const submitPayment = useCallback(async (content: string, input: PaymentInput) => {
    setProcessing(true);
    setToast(undefined);

    try {
      const body: PaymentCreateFromFaceRequest = {
        store_id: input.store_id,
        content,
        amount: input.amount,
      };
      const { data: pay } = await json<SuccessResponse<PaymentTransactionHash>>("/payment/request/with/face", {
        method: "POST",
        body: JSON.stringify(body),
      });

      const status = await pollUntilDone(pay.payment_request_id);
      showToast(
        status === "paid"
          ? { kind: "success", title: "決済完了", text: "ありがとうございました", amount: body.amount }
          : { kind: "error", title: "決済に失敗しました", text: "支払い処理を完了できませんでした。" },
      );
    } catch (error) {
      if (!cancelled.current) {
        showToast({
          kind: "error",
          title: error instanceof ApiError ? error.message : "決済に失敗しました",
          text: error instanceof ApiError ? undefined : "支払い処理を完了できませんでした。",
        });
      }
    } finally {
      if (!cancelled.current) {
        setProcessing(false);
        submitting.current = false;
        setPaymentInput(undefined);
      }
    }
  }, [json, pollUntilDone, showToast]);

  const captureAndPay = useCallback(async () => {
    const video = videoRef.current;
    const input = paymentInput;
    if (!video || !input || submitting.current) return;

    submitting.current = true;
    const content = captureCompressedBase64(video);
    stopCamera();
    await submitPayment(content, input);
  }, [paymentInput, submitPayment]);

  useEffect(() => {
    if (!paymentInput) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let faceVisibleSince: number | undefined;

    async function startCamera() {
      setCameraError(undefined);
      setCameraReady(false);
      setDetecting(false);

      try {
        if (!window.isSecureContext) {
          throw Error("camera access requires localhost or HTTPS");
        }
        if (!navigator.mediaDevices?.getUserMedia) {
          throw Error("navigator.mediaDevices.getUserMedia is unavailable");
        }

        const stream = await openCamera();
        if (!active) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) return;

        video.srcObject = stream;
        await waitForVideoMetadata(video);
        try {
          await video.play();
        } catch (error) {
          throw Error(describeCameraError(error, "video.play"));
        }
        setCameraReady(true);
        setDetecting(true);

        if (!window.FaceDetector) {
          timer = setTimeout(() => {
            if (active && !submitting.current && !cancelled.current) void captureAndPay();
          }, requiredFaceVisibleMs);
          return;
        }

        const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        const detect = async () => {
          if (!active || submitting.current || cancelled.current) return;
          try {
            const frame = drawFaceFrame(video, 240) as HTMLCanvasElement;
            const faces = await detector.detect(frame);
            if (faces.length > 0) {
              faceVisibleSince ??= Date.now();
              if (Date.now() - faceVisibleSince >= requiredFaceVisibleMs) {
                await captureAndPay();
                return;
              }
            } else {
              faceVisibleSince = undefined;
            }
          } catch {
            faceVisibleSince = undefined;
            setCameraError("顔検出に失敗しました。明るい場所で正面を向いてください。");
          }
          timer = setTimeout(detect, 500);
        };

        timer = setTimeout(detect, 500);
      } catch (error) {
        if (active) {
          console.error(error);
          setCameraError(`カメラを起動できませんでした。ブラウザのカメラ権限を確認してください。${describeCameraError(error, "camera")}`);
        }
      }
    }

    startCamera();

    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      stopCamera();
    };
  }, [captureAndPay, paymentInput]);

  function submitInput(e: React.SyntheticEvent<HTMLFormElement, SubmitEvent>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setPaymentInput({
      store_id: Number(f.get("store_id")),
      amount: Number(f.get("amount")),
    });
  }

  function retryCamera() {
    stopCamera();
    submitting.current = false;
    setCameraError(undefined);
    setPaymentInput((current) => (current ? { ...current } : current));
  }

  const showingCamera = Boolean(paymentInput);

  return (
    <main className="min-h-dvh bg-zinc-950 px-4 py-10 text-zinc-100">
      {processing && <ProcessingOverlay />}
      {toast && <PaymentResultDialog toast={toast} durationMs={toastDurationMs} />}

      <section className="mx-auto grid max-w-3xl gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Teraid Pay 顔認証決済</h1>
          <Link href="/" className="rounded-md border border-zinc-700 px-3 py-2 text-sm text-zinc-200 hover:bg-zinc-900">
            ユーザーID決済へ
          </Link>
        </div>

        {!showingCamera ? (
          <form onSubmit={submitInput} className="grid gap-3 rounded-lg bg-white p-5 text-zinc-950 shadow-xl">
            <label className="grid gap-1 text-sm font-medium">
              store_id
              <input name="store_id" type="number" min="1" required className="rounded-md border px-3 py-2" />
            </label>
            <label className="grid gap-1 text-sm font-medium">
              金額
              <input name="amount" type="number" min="1" required className="rounded-md border px-3 py-2" />
            </label>
            <button className="rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white">顔認証開始</button>
          </form>
        ) : (
          <section className="grid gap-4 rounded-lg bg-white p-5 text-zinc-950 shadow-xl">
            <div className="relative overflow-hidden rounded-md bg-zinc-950">
              <video ref={videoRef} playsInline muted className="aspect-square w-full object-cover" />
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="relative aspect-square w-[72%] rounded-md border-4 border-emerald-400 shadow-[0_0_0_999px_rgba(0,0,0,0.35)]">
                  <div className="absolute left-1/2 top-1/2 h-12 w-px -translate-x-1/2 -translate-y-1/2 bg-emerald-300/90 shadow-[0_0_12px_rgba(110,231,183,0.9)]" />
                  <div className="absolute left-1/2 top-1/2 h-px w-12 -translate-x-1/2 -translate-y-1/2 bg-emerald-300/90 shadow-[0_0_12px_rgba(110,231,183,0.9)]" />
                  <div className="absolute left-1/2 top-[13%] h-[72%] w-[56%] -translate-x-1/2 rounded-[50%] border-2 border-emerald-300/80 shadow-[0_0_18px_rgba(110,231,183,0.45)]" />
                  <div className="absolute left-1/2 top-[20%] h-[58%] w-[43%] -translate-x-1/2 rounded-[50%] border border-cyan-200/45" />
                  <div className="absolute left-[16%] top-1/2 h-px w-[18%] bg-cyan-200/60" />
                  <div className="absolute right-[16%] top-1/2 h-px w-[18%] bg-cyan-200/60" />
                  <div className="absolute left-1/2 top-[16%] h-[10%] w-px -translate-x-1/2 bg-cyan-200/60" />
                  <div className="absolute bottom-[16%] left-1/2 h-[10%] w-px -translate-x-1/2 bg-cyan-200/60" />
                </div>
              </div>
            </div>

            <div className="grid gap-2 text-sm">
              <p className="font-medium">
                {cameraError
                  ? "顔認証を開始できません"
                  : detecting
                    ? "顔を検出しています"
                    : cameraReady
                      ? "カメラを準備しています"
                      : "カメラを起動しています"}
              </p>
              {cameraError && <p className="text-red-600">{cameraError}</p>}
            </div>

            <div className="flex flex-wrap gap-2">
              {cameraError && (
                <button type="button" onClick={retryCamera} className="rounded-md bg-emerald-600 px-4 py-2 font-semibold text-white">
                  再試行
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  stopCamera();
                  setPaymentInput(undefined);
                }}
                className="rounded-md border px-4 py-2 font-semibold"
              >
                戻る
              </button>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

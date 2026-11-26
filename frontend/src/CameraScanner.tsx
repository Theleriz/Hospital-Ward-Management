import type { DecodeHintType as HintType } from "@zxing/library";
import { useEffect, useRef, useState } from "react";

// Reads the Code 128 barcode on a badge with the webcam or the tablet camera.
// ZXing, not the browser's BarcodeDetector: that one does not exist in Chrome on Windows.
// The browser gives the camera only to HTTPS pages (or localhost).
export default function CameraScanner({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  // The latest callback, without restarting the camera on every render
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("Камера доступна только по HTTPS. Откройте систему по адресу https://…");
      return;
    }

    let stopped = false;
    let stop = () => {};

    (async () => {
      // Loaded only when someone scans, so the login screen stays small
      const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
        import("@zxing/browser"),
        import("@zxing/library"),
      ]);
      const hints = new Map<HintType, unknown>([
        [DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]],
        [DecodeHintType.TRY_HARDER, true],
      ]);
      const reader = new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 100 });
      const controls = await reader.decodeFromConstraints(
        // Back camera on a tablet or phone; any camera on a laptop
        { video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } } },
        videoRef.current!,
        (result) => {
          if (result && !stopped) {
            stopped = true;
            stop();
            onResultRef.current(result.getText().trim());
          }
        },
      );
      stop = () => controls.stop();
      if (stopped) stop();
    })().catch((err: unknown) => {
      const name = err instanceof DOMException ? err.name : "";
      setError(
        name === "NotAllowedError"
          ? "Доступ к камере запрещён. Разрешите его в настройках браузера для этого сайта."
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "Камера не найдена."
            : "Не удалось включить камеру.",
      );
    });

    return () => {
      stopped = true;
      stop();
    };
  }, []);

  return (
    <dialog ref={dialogRef} className="scanner" aria-labelledby="scanner-title" onClose={onClose}>
      <h1 id="scanner-title">Сканирование бейджа</h1>
      <p className="hint">Поднесите штрих-код бейджа к камере.</p>
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : (
        <div className="scanner-view">
          <video ref={videoRef} muted playsInline />
          <span className="scanner-line" aria-hidden="true" />
        </div>
      )}
      <form method="dialog">
        <button type="submit" className="secondary button-block" autoFocus>
          Отмена
        </button>
      </form>
    </dialog>
  );
}

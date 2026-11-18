import './scan.css';

import { Button, Notice, Spinner } from '@grandmas-wallet/ui';
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type * as Scanning from 'qr-scanner';

import { type CameraInfo, type ScanFilter, cameraRound, describeCamera, nextCamera } from './scan.js';
import { keep, kept } from './session.js';

/**
 * Reading a QR code with the phone's camera, or from a picture, into a field that would otherwise be pasted
 * into. The scanning library is loaded only when the scanner is opened.
 */

type Problem = 'insecure' | 'none' | 'refused' | 'busy';

const PROBLEMS: Record<Problem, string> = {
  insecure: 'The camera works only when this page is opened over a secure connection, at an address starting with https://. Use a picture instead, or paste the text.',
  none: 'This device has no camera the page can use. Use a picture instead, or paste the text.',
  refused: 'The page may not use the camera. Allow the camera for this site in the browser\'s settings and try again, or use a picture.',
  busy: 'The camera is in use by another app or tab. Close it there and try again, or use a picture.',
};

/** The library's class. Its types are written for CommonJS; the build loads it as a module with a default export. */
type Library = typeof Scanning.default.default;
type Scanner = InstanceType<Library>;
type ScanRegion = NonNullable<Parameters<Library['scanImage']>[1]>;

const loadLibrary = async (): Promise<Library> => {
  const loaded = (await import('qr-scanner')) as unknown as { default: Library & { default?: Library } };
  return loaded.default.default ?? loaded.default;
};

/** The part of the picture that is searched: a centred square, as the frame on the screen shows it. */
const centredSquare = (video: HTMLVideoElement): ScanRegion => {
  const side = Math.round(Math.min(video.videoWidth, video.videoHeight) * 0.8);
  const scaled = Math.min(side, 600);
  return { x: Math.round((video.videoWidth - side) / 2), y: Math.round((video.videoHeight - side) / 2), width: side, height: side, downScaledWidth: scaled, downScaledHeight: scaled };
};

/** A refusal by the browser comes back from the library as "Camera not found." whatever its cause. */
const diagnose = async (library: Library): Promise<Problem> => {
  if (!(await library.hasCamera())) return 'none';
  const permission = await navigator.permissions?.query({ name: 'camera' as PermissionName }).then(
    (status) => status.state,
    () => undefined,
  );
  return permission === 'granted' ? 'busy' : 'refused';
};

interface Zoom {
  min: number;
  max: number;
  step: number;
  value: number;
}

const CameraIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" class="scan-icon">
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </svg>
);

const SwitchIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true" class="scan-icon">
    <path d="M4 9h13l-3-3M20 15H7l3 3" />
  </svg>
);

/**
 * The scanner, as a dialog over the page: full screen on a phone, a panel on a desktop. A code of the kind the
 * field takes closes it and is handed back; a code of another kind is named and the scanner stays open.
 */
export const ScanDialog = ({ filter, onScan, onClose }: { filter: ScanFilter; onScan: (text: string) => void; onClose: () => void }) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const scanner = useRef<Scanner | undefined>(undefined);
  const finished = useRef(false);
  const switching = useRef(false);
  const [state, setState] = useState<'starting' | 'running' | Problem>('starting');
  const [round, setRound] = useState<CameraInfo[]>([]);
  const [current, setCurrent] = useState<string | undefined>();
  const [zoom, setZoom] = useState<Zoom | undefined>();
  const [message, setMessage] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);
  const latest = useRef({ filter, onScan, onClose });
  latest.current = { filter, onScan, onClose };

  const track = (): MediaStreamTrack | undefined => (video.current?.srcObject instanceof MediaStream ? video.current.srcObject.getVideoTracks()[0] : undefined);

  /** Which camera is running, and whether it can zoom. */
  const follow = (): void => {
    const running = track();
    if (running === undefined) return;
    setCurrent(running.getSettings().deviceId);
    const range = (running.getCapabilities?.() as { zoom?: { min?: number; max?: number; step?: number } } | undefined)?.zoom;
    if (range?.min === undefined || range.max === undefined || range.max <= range.min) {
      setZoom(undefined);
      return;
    }
    const value = (running.getSettings() as { zoom?: number }).zoom ?? range.min;
    setZoom({ min: range.min, max: range.max, step: range.step ?? 0.1, value });
  };

  const close = (value?: string): void => {
    if (finished.current) return;
    finished.current = true;
    if (dialog.current?.open === true) dialog.current.close();
    latest.current.onClose();
    if (value !== undefined) latest.current.onScan(value);
  };

  const read = (text: string, fromCamera: boolean): void => {
    if (finished.current) return;
    const value = latest.current.filter.accept(text);
    if (value === undefined) {
      setMessage(latest.current.filter.wrong);
      return;
    }
    // The camera that read a code is the one the next scan starts with.
    const used = fromCamera ? track()?.getSettings().deviceId : undefined;
    if (used !== undefined && used !== '') keep('scanCamera', used);
    close(value);
  };

  useEffect(() => {
    if (dialog.current !== null && !dialog.current.open) dialog.current.showModal();
  }, []);

  useEffect(() => {
    let stopped = false;
    let made: Scanner | undefined;
    setState('starting');
    const start = async (): Promise<void> => {
      if (!window.isSecureContext || navigator.mediaDevices?.getUserMedia === undefined) {
        setState('insecure');
        return;
      }
      const library = await loadLibrary();
      if (stopped || video.current === null) return;
      // The camera of the last successful scan, if the browser still has it; otherwise its own choice of a rear camera.
      const remembered = kept('scanCamera');
      const known = remembered === undefined ? [] : await library.listCameras(false).catch(() => []);
      if (stopped) return;
      made = new library(video.current, (result) => read(result.data, true), {
        returnDetailedScanResult: true,
        // The library reports every frame without a code; that is not a problem to show.
        onDecodeError: () => undefined,
        preferredCamera: remembered !== undefined && known.some((camera) => camera.id === remembered) ? remembered : 'environment',
        maxScansPerSecond: 10,
        calculateScanRegion: centredSquare,
      });
      made.setInversionMode('both');
      scanner.current = made;
      try {
        await made.start();
      } catch {
        if (!stopped) setState(await diagnose(library));
        return;
      }
      if (stopped) return;
      setState('running');
      const cameras = await library.listCameras(true).catch(() => []);
      if (stopped) return;
      setRound(cameraRound(cameras));
      follow();
      // A browser that names its cameras only once one is allowed starts on its own choice; the remembered one follows.
      const running = track()?.getSettings().deviceId;
      if (remembered !== undefined && running !== remembered && cameras.some((camera) => camera.id === remembered)) {
        await made.setCamera(remembered);
        follow();
      }
    };
    void start();
    // The camera is released as soon as the page is hidden; the library starts it again when the page is shown.
    const onHidden = () => {
      if (document.hidden) void made?.pause(true);
    };
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onHidden);
      scanner.current = undefined;
      if (made !== undefined) {
        void made.pause(true);
        made.destroy();
      }
    };
  }, [attempt]);

  const switchCamera = async (): Promise<void> => {
    const next = nextCamera(round, current);
    if (round.length < 2 || next === undefined || scanner.current === undefined || switching.current) return;
    switching.current = true;
    setMessage(undefined);
    try {
      await scanner.current.setCamera(next.id);
      follow();
    } finally {
      switching.current = false;
    }
  };

  const applyZoom = (value: number): void => {
    setZoom((known) => (known === undefined ? undefined : { ...known, value }));
    void track()
      ?.applyConstraints({ advanced: [{ zoom: value } as MediaTrackConstraintSet] })
      .catch(() => undefined);
  };

  const fromPicture = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    setMessage(undefined);
    const library = await loadLibrary();
    try {
      const result = await library.scanImage(file, { returnDetailedScanResult: true, alsoTryWithoutScanRegion: true });
      read(result.data, false);
    } catch {
      setMessage('No QR code was found in that picture.');
    }
  };

  const switchable = state === 'running' && round.length > 1;
  const caption = state === 'running' ? describeCamera(round, current) : undefined;
  const problem = state === 'starting' || state === 'running' ? undefined : state;

  return (
    <dialog
      ref={dialog}
      class="scan-dialog"
      aria-labelledby="scan-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div class="scan-body">
        <div class="scan-head">
          <div>
            <h2 id="scan-title">Scan a QR code</h2>
            <p class="small muted">{filter.wants}</p>
          </div>
          <button type="button" class="quiet small scan-close" onClick={() => close()}>
            Close
          </button>
        </div>
        <div class={`scan-view${switchable ? ' switchable' : ''}`} onClick={() => void switchCamera()} data-testid="scan-view">
          <video ref={video} muted playsInline onPlaying={follow} />
          {state === 'running' && <div class="scan-frame" aria-hidden="true" />}
          {switchable && (
            <button
              type="button"
              class="scan-switch"
              title="Switch camera"
              onClick={(event) => {
                event.stopPropagation();
                void switchCamera();
              }}
            >
              <SwitchIcon />
              <span class="scan-hidden">Switch camera</span>
            </button>
          )}
          {state === 'starting' && (
            <div class="scan-cover">
              <Spinner />
              <span>Starting the camera…</span>
            </div>
          )}
          {problem !== undefined && (
            <div class="scan-cover problem" role="alert">
              <span>{PROBLEMS[problem]}</span>
              {(problem === 'refused' || problem === 'busy') && (
                <Button small kind="secondary" onClick={() => setAttempt((count) => count + 1)}>
                  Try again
                </Button>
              )}
            </div>
          )}
        </div>
        {(caption !== undefined || switchable) && (
          <div class="scan-caption small">
            {caption !== undefined && <span data-testid="scan-camera">{caption}</span>}
            {switchable && <span class="muted">Tap to switch camera</span>}
          </div>
        )}
        {zoom !== undefined && (
          <label class="scan-zoom small">
            <span>Zoom</span>
            <input type="range" min={zoom.min} max={zoom.max} step={zoom.step} value={zoom.value} onInput={(event) => applyZoom(Number((event.currentTarget as HTMLInputElement).value))} />
          </label>
        )}
        {message !== undefined && <Notice tone="warn">{message}</Notice>}
        <div class="scan-actions">
          <label class="button secondary scan-picture">
            Use a picture
            <input
              type="file"
              accept="image/*"
              onChange={(event) => {
                const input = event.currentTarget as HTMLInputElement;
                void fromPicture(input.files?.[0]);
                input.value = '';
              }}
            />
          </label>
          <Button kind="quiet" onClick={() => close()}>
            Cancel
          </Button>
        </div>
      </div>
    </dialog>
  );
};

/** The button that opens the scanner for one field. */
export const ScanButton = ({ filter, onScan }: { filter: ScanFilter; onScan: (text: string) => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" class="secondary scan-button" title="Scan a QR code" onClick={() => setOpen(true)}>
        <CameraIcon />
        <span>Scan</span>
      </button>
      {open && <ScanDialog filter={filter} onScan={onScan} onClose={() => setOpen(false)} />}
    </>
  );
};

/** A field's input with the scan button beside it. A scan fills the field as a paste would. */
export const WithScan = ({ filter, onScan, children }: { filter: ScanFilter; onScan: (text: string) => void; children: ComponentChildren }) => (
  <div class="with-scan">
    {children}
    <ScanButton filter={filter} onScan={onScan} />
  </div>
);

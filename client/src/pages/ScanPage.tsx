import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import BackButton from '../components/common/BackButton';
import { Overlay } from '../components/common/Overlay';
import { CaptureBadge, StatGrid, type PlantAvatarData } from '../components/common/PlantVisuals';
import { useToast } from '../hooks/useToast';
import {
  PipelineRequestError,
  streamPipeline,
  type PipelineEvent,
} from '../services/pipelineStream';
import { getAvatar } from '../services/sproutApi';
import { toPlantAvatarData } from '../utils/avatarPresentation';

/**
 * Scan screen — ported from plantemon-web's (app)/scan/page.tsx, itself a port
 * of the Android ui/ScanActivity.java + layout/activity_scan.xml.
 *
 * plantemon-web called its own /api/identify and /api/sprite routes. Here the
 * work is done by the sprite pipeline migrated from Sprout_Dev_Platform, which
 * runs all four hops behind one streaming endpoint and reports each as it
 * lands — so the stepper below shows real observed transitions rather than a
 * timer, which is what the original had to fake.
 *
 * Camera handling is the part that differs most from Android. Two input paths
 * are offered:
 *  - a live getUserMedia preview, when the browser grants it
 *  - a file input with `capture="environment"`, which opens the camera app
 *    directly and is the reliable path on iOS
 * The Android "test image" button is kept as a third path, so the pipeline can
 * be exercised without a real plant to hand.
 */

/**
 * How the photo reached the pipeline, which is what decides whether the saved
 * plant is kept or expires.
 *
 * The camera — live preview or the OS camera app — means someone stood in front
 * of a real plant, so it is an IRL scan and the record is permanent. A file off
 * disk could be any picture of anything, so it is a web upload: playable and
 * battleable, but gone in 24 hours. The server enforces this; the two values
 * here are just the two buttons.
 */
type CaptureSource = 'mobile' | 'web';

/** The client-visible stages of a scan, in order. */
type ScanStep = 'identify' | 'sprite' | 'finish';

/**
 * The `discovery` block of the pipeline's `complete` event.
 *
 * Exported so ScanPage.test.tsx types its fixture against the very shape this
 * page reads — the two used to be able to drift, and did.
 *
 * `discoveryCount` counts *scans*, not people: the dex increments it on every
 * scan, including repeats by the same user (server/repositories/dex.ts). One
 * person scanning a fern five times makes it 5, so it must never be labelled as
 * a number of explorers.
 */
export interface ScanDiscovery {
  firstDiscoveredByName: string;
  firstDiscoveredAt: string;
  discoveryCount: number;
  isFirstDiscoverer: boolean;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'busy'; step: ScanStep; plantName?: string; detail?: string }
  | { kind: 'naming'; photo: string; source: CaptureSource }
  | {
      kind: 'done';
      sprite: string;
      name: string;
      source: CaptureSource;
      avatarId: string | null;
      saved: boolean;
      saveError?: string;
      discovery: ScanDiscovery | null;
    }
  | {
      /** Plant.id was not sure enough to be worth a render. Its own state
       *  rather than an error: nothing went wrong, the photo was just not
       *  good enough, and the way out is another photo. */
      kind: 'lowConfidence';
      name: string;
      probability: number;
      threshold: number;
    };

// There is no 'error' variant: every scan failure is raised as a toast, so
// there is no per-screen error state to hold. Keeping one would mean a second
// surface that nothing writes to.

/**
 * What to tell the player when a run could not start or finish.
 *
 * Branches on the failure's kind rather than its wording. The offline case is
 * the one that matters most here: a scan is the one screen a user is likely to
 * open away from wifi, standing in front of a plant.
 */
function isOfflineFailure(error: unknown): boolean {
  if (error instanceof PipelineRequestError) return error.kind === 'offline';
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function scanErrorMessage(error: unknown): string {
  if (error instanceof PipelineRequestError) {
    switch (error.kind) {
      case 'offline':
        return 'No connection. Reconnect to wifi or mobile data, then scan again.';
      case 'unauthorised':
        return 'Please sign in to scan a plant.';
      default:
        return error.message;
    }
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return 'No connection. Reconnect to wifi or mobile data, then scan again.';
  }
  return error instanceof Error ? error.message : 'Something went wrong.';
}

/** Maps a pipeline hop id onto the three stages the player is shown. */
const STEP_FOR_HOP: Record<string, ScanStep> = {
  '1': 'identify',
  '2a': 'sprite',
  '2b': 'sprite',
  '2c': 'finish',
  '2d': 'finish',
  '3': 'finish',
  '4': 'finish',
};

/**
 * What the player is told each hop is doing.
 *
 * The server sends its own `details` for every hop, and the studio's Live
 * Scanner wants exactly that — it is a pipeline console. A player is not the
 * audience for it. Passing it straight through meant every scan printed the
 * vendor list ("via Plant.id API v3", "NVIDIA Flux.2 Klein 4B", "via
 * withoutBG"), the exact model id, implementation detail ("nearest-neighbor",
 * "Spica72 palette"), and — on hop 2a — the ENTIRE crafted prompt, verbatim.
 *
 * That is the pipeline's own IP and its whole supply chain, shown to anyone
 * who scans a leaf. The codebase already guards this elsewhere: extractApiError
 * exists to stop raw server text reaching players, and the battle serializer
 * redacts the bot's move list. This path simply bypassed that thinking.
 *
 * So the copy lives here, on the client, keyed by hop. The server contract is
 * untouched and the studio still sees everything.
 */
const PLAYER_HOP_COPY: Record<string, string> = {
  '1': 'Analysing your plant...',
  '2a': 'Dreaming up a design...',
  '2b': 'Creating the sprite...',
  '2c': 'Cleaning up the edges...',
  '2d': 'Polishing the pixels...',
  '3': 'Assigning stats and moves...',
  '4': 'Almost done...',
};

const MAX_IMAGE_EDGE = 1024;

/** UC6 alt-flow 2a: accepted upload formats and the 5 MB size ceiling. Client
 *  side only — the server remains authoritative and checks magic bytes, not
 *  just this declared MIME type. Decimal MB (1000 x 1000), matching what
 *  Finder/most file browsers report as a file's size in MB — using the
 *  binary 1024 x 1024 reading here let some 5.x MB files slip under a
 *  "5 MB" cap that looked, to the user, like it should have caught them. */
const ACCEPTED_UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_UPLOAD_BYTES = 5 * 1000 * 1000;

function validateUploadFile(file: File): string | null {
  if (!ACCEPTED_UPLOAD_TYPES.includes(file.type)) {
    return 'Please upload a JPEG, PNG, or WEBP image.';
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return 'That file is too large — the maximum size is 5 MB.';
  }
  return null;
}

/** Downscales to a JPEG data URL — the shape the pipeline endpoint expects. */
async function fileToJpegDataUrl(file: Blob): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not read that image.');
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  return canvas.toDataURL('image/jpeg', 0.85);
}

/** Grabs the current video frame at the same ceiling. */
function captureFrame(video: HTMLVideoElement): string {
  const scale = Math.min(
    1,
    MAX_IMAGE_EDGE / Math.max(video.videoWidth, video.videoHeight)
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(video.videoWidth * scale);
  canvas.height = Math.round(video.videoHeight * scale);
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.85);
}

export default function ScanPage() {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  // The pipeline's `complete` event only carries `maxHealth`/`speed` (from
  // assemblePlant, no attack/defense at all) — the real, complete stats live
  // on the AvatarRecord that persistScan already wrote. Fetched separately via
  // the existing GET /api/avatar/:avatarId once we have an id, rather than
  // widening the SSE payload.
  const [avatarDetails, setAvatarDetails] = useState<PlantAvatarData | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  // The camera ring falls back to cameraInput (capture) when the live preview
  // is unavailable, which opens the native camera on a phone. The upload path
  // has its own file input inside UploadDialog instead of one here.
  const cameraInputRef = useRef<HTMLInputElement>(null);
  // Guards against overlapping runs, like ScanActivity's AtomicBoolean.
  const processingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);

  // Start the live preview, and always release the camera on unmount —
  // otherwise the indicator light stays on after navigating away.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraError('Live camera is not available in this browser.');
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        // The <video> only mounts once cameraReady flips true, so videoRef is
        // still null here. A separate effect attaches the stream after mount.
        setCameraReady(true);
      } catch {
        // Permission denied or unsupported: the file-input path still works.
        setCameraError('Camera unavailable — use Upload instead.');
      }
    })();

    return () => {
      cancelled = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      abortRef.current?.abort();
    };
  }, []);

  // Attach the captured stream once the <video> element actually exists. Doing
  // this inside the getUserMedia callback failed because the ref was null then.
  useEffect(() => {
    const video = videoRef.current;
    if (cameraReady && video && streamRef.current) {
      video.srcObject = streamRef.current;
      // Attaching srcObject after mount does not reliably trigger autoPlay, so
      // start it explicitly. Safe to ignore the promise — it is muted+inline.
      void video.play().catch(() => {});
    }
  }, [cameraReady]);

  // Fetches the real, persisted stats/species record once a scan finishes and
  // actually saved — the SSE stream itself never carries a complete stat set.
  // Cleared whenever we leave the 'done' state so stale details can't leak
  // into the next scan's result screen.
  useEffect(() => {
    if (status.kind !== 'done' || !status.avatarId) {
      setAvatarDetails(null);
      return;
    }
    let cancelled = false;
    void getAvatar(status.avatarId).then(
      (record) => {
        if (!cancelled) setAvatarDetails(toPlantAvatarData(record));
      },
      () => {
        // Best-effort: the result screen still works without this, just
        // without the species/stats detail (falls back to name + sprite).
        if (!cancelled) setAvatarDetails(null);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [status]);

  /** The shared tail of every input path. */
  const runPipeline = useCallback(
    async (jpegDataUrl: string, source: CaptureSource, customName?: string) => {
    if (processingRef.current) return;
    processingRef.current = true;

    const controller = new AbortController();
    abortRef.current = controller;
    let finalSprite: string | null = null;
    let finalName = customName ?? '';
    /** Set when the server gives up on a too-unsure identification.
     *
     *  Widened on the initializer rather than annotated: the only writer is the
     *  stream callback below, and control flow analysis does not look inside a
     *  nested function. A plain `: T | null = null` would leave this pinned to
     *  `null` for the rest of the run, so the read after the stream could not
     *  narrow back to the object. */
    let lowConfidence = null as { name: string; probability: number; threshold: number } | null;
    /** Set when the server could not identify the plant at all and is asking
     *  the player to name it themselves. */
    let needsName = false;
    let savedOutcome: {
      saved: boolean;
      saveError?: string;
      avatarId: string | null;
      discovery: ScanDiscovery | null;
    } = {
      saved: true,
      avatarId: null,
      discovery: null,
    };

    try {
      setStatus({ kind: 'busy', step: 'identify' });

      await streamPipeline(
        '/api/pipeline/run-stream',
        {
          imageBase64: jpegDataUrl,
          customName: customName || undefined,
          // Decides the saved record's lifetime; the server defaults an
          // undeclared caller to 'web', the expiring one.
          source,
          // The pause after the render hop is a studio affordance — it exists so
          // an operator can inspect the raw sprite before the cutout runs. A
          // player just wants the finished creature, so run straight through.
          pauseAt2b: false,
        },
        (event: PipelineEvent) => {
          if (event.event === 'step_start' || event.event === 'step_done') {
            const hop = String(event.step);
            const step = STEP_FOR_HOP[hop];
            if (step) {
              // Our copy, not the server's — see PLAYER_HOP_COPY.
              setStatus((current) =>
                current.kind === 'busy'
                  ? { ...current, step, detail: PLAYER_HOP_COPY[hop] ?? '' }
                  : current
              );
            }
          }

          if (event.event === 'step_done' && event.step === '1') {
            const identification = event.result as
              | { name?: string; common_names?: string[] }
              | undefined;
            /* Name the find as soon as it is known, in the words a player uses.
               Plant.id returns a binomial plus common names; "Is your plant a
               chalk milkwort?" lands where "Polygala calcarea" does not. Falls
               back to the binomial when there is no common name, which is
               common for cultivars. */
            const common = identification?.common_names?.[0];
            if (common || identification?.name) {
              const friendly = common ?? identification?.name;
              setStatus((current) =>
                current.kind === 'busy'
                  ? { ...current, detail: `Is your plant a ${friendly}?` }
                  : current
              );
            }
            if (identification?.name) {
              finalName = identification.name;
              setStatus((current) =>
                current.kind === 'busy'
                  ? { ...current, plantName: identification.name }
                  : current
              );
            }
          }

          if (event.event === 'complete') {
            const plant = event.finalPlant as { name?: string } | undefined;
            finalName = plant?.name ?? finalName;
            /* Two shapes, because the server has two ways to finish. A run
               that rendered sends the finished bytes; a run that reused the
               species' published sprite sends that object's url instead, and
               pulling its bytes through the API purely to re-encode them as
               base64 would be a round trip for nothing. Both end up as an
               <img src>, so the difference stops here. */
            finalSprite = event.finalSpriteUrl
              ? String(event.finalSpriteUrl)
              : `data:image/png;base64,${String(event.finalSpriteB64)}`;
            savedOutcome = {
              saved: event.saved !== false,
              saveError: event.saveError ? String(event.saveError) : undefined,
              avatarId: event.avatarId ? String(event.avatarId) : null,
              discovery: (event.discovery ?? null) as ScanDiscovery | null,
            };
          }

          if (event.event === 'needs_name') {
            needsName = true;
            return;
          }
          if (event.event === 'low_confidence') {
            lowConfidence = {
              name: String(event.name ?? 'that plant'),
              probability: Number(event.probability ?? 0),
              threshold: Number(event.threshold ?? 0.7),
            };
            return;
          }
          if (event.event === 'pipeline_error' || event.event === 'error') {
            throw new Error(String(event.error ?? 'The pipeline failed.'));
          }
        },
        controller.signal
      );

      // Plant.id could not name it, so the player is asked. This is the state
      // NameDialog has always been written for; nothing used to reach it,
      // because the server invented "Unknown Plant Species" instead.
      if (needsName) {
        setStatus({ kind: 'naming', photo: jpegDataUrl, source });
        return;
      }

      // The server stops before generating when it is not sure enough, so a
      // missing sprite here is expected rather than a fault.
      if (lowConfidence) {
        // No toast here: NotSureDialog is modal and has room for the advice
        // that actually helps. Two surfaces for one message is noise.
        setStatus({ kind: 'lowConfidence', ...lowConfidence });
        return;
      }

      if (!finalSprite) {
        throw new Error('The pipeline finished without producing a sprite.');
      }

      setStatus({
        kind: 'done',
        sprite: finalSprite,
        name: finalName || 'Unknown Plant',
        source,
        avatarId: savedOutcome.avatarId,
        saved: savedOutcome.saved,
        saveError: savedOutcome.saveError,
        discovery: savedOutcome.discovery,
      });
    } catch (error) {
      // Decided by the failure's own kind, not by searching its text. The old
      // check was `message.includes('401')`, which reported an offline device
      // as "please sign in" — Firebase's token refresh fails with a network
      // error before any request is sent, so the user was told to do the one
      // thing that could not help.
      // A run the player cancelled is not a failure and gets no toast — they
      // know what they did, and telling them is noise.
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatus({ kind: 'idle' });
        return;
      }

      // Toast rather than an inline line: the progress overlay covers the
      // screen while a run is going, so a message painted underneath it is one
      // the player never sees. The toast also carries the way out.
      const message = scanErrorMessage(error);
      setStatus({ kind: 'idle' });
      showToast({
        tone: 'error',
        message,
        action: isOfflineFailure(error)
          ? { label: 'Retry', onSelect: () => void runPipeline(jpegDataUrl, source, customName) }
          : undefined,
      });
    } finally {
      processingRef.current = false;
      abortRef.current = null;
    }
    // showToast is stable (memoised in ToastProvider), but declared so the
    // dependency is honest rather than implicitly assumed.
  }, [showToast]);

  const onCapture = useCallback(() => {
    // Live preview available: grab a frame. Otherwise open the native camera.
    if (cameraReady && videoRef.current) {
      void runPipeline(captureFrame(videoRef.current), 'mobile');
    } else {
      cameraInputRef.current?.click();
    }
  }, [cameraReady, runPipeline]);

  const onFilePicked = useCallback(
    async (file: File | undefined, source: CaptureSource) => {
      if (!file) return;
      try {
        void runPipeline(await fileToJpegDataUrl(file), source);
      } catch (error) {
        // The thrown text here is a DOM/FileReader message — not something to
        // put in front of a player.
        if (import.meta.env.DEV) console.warn('Could not read the picked file:', error);
        showToast({
          tone: 'error',
          message: 'That image could not be opened. Try another photo.',
        });
      }
    },
    [runPipeline, showToast]
  );

  const onTestImage = useCallback(async () => {
    try {
      const response = await fetch('/img/test_plant.jpg');
      if (!response.ok) throw new Error('Could not load the test image.');
      // The bundled photo is a file like any other, so it saves as a web upload.
      void runPipeline(await fileToJpegDataUrl(await response.blob()), 'web');
    } catch (error) {
      // Raised as a toast, not a status: there is no 'error' variant on this
      // screen any more (see the Status union). The thrown text is a fetch/DOM
      // message, so it stays in the log and the player gets fixed copy.
      if (import.meta.env.DEV) console.warn('Could not load the test image:', error);
      showToast({ tone: 'error', message: 'Could not load the test image.' });
    }
  }, [runPipeline, showToast]);

  const busy = status.kind === 'busy';

  return (
    <main className="screen flex flex-col">
      {/*
        Black backdrop at the very back. It must NOT live as `bg-black` on
        <main>: main does not form a stacking context, so a -z-10 video would
        paint *behind* main's own background and show as a black screen. A
        separate -z-20 layer sits behind the video instead.
      */}
      <div className="absolute inset-0 -z-20 bg-black" />

      {/* Live preview, or the painted background when unavailable */}
      {cameraReady ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          onLoadedMetadata={(event) => void event.currentTarget.play().catch(() => {})}
          className="absolute inset-0 -z-10 h-full w-full object-cover"
        />
      ) : (
        <img
          src="/img/bg_scan.png"
          alt=""
          className="absolute inset-0 -z-10 h-full w-full object-cover"
        />
      )}

      <div className="safe-top flex items-center justify-between px-3">
        <BackButton />
      </div>

      {/* Viewfinder framing, borrowed from the scanner patterns */}
      <div className="pointer-events-none flex flex-1 items-center justify-center p-8">
        <div className="relative aspect-square w-full max-w-sm">
          {[
            'left-0 top-0 border-l-4 border-t-4',
            'right-0 top-0 border-r-4 border-t-4',
            'left-0 bottom-0 border-l-4 border-b-4',
            'right-0 bottom-0 border-r-4 border-b-4',
          ].map((corner) => (
            <span key={corner} className={`absolute h-10 w-10 border-white/90 ${corner}`} />
          ))}
        </div>
      </div>

      {/* Error / camera-hint line (the busy state uses the full overlay below) */}
      <div className="px-6 text-center">
        {status.kind === 'idle' && cameraError && (
          <p className="pixel-panel inline-block px-3 py-2 text-[9px]">{cameraError}</p>
        )}
      </div>

      {/* Full-screen progress while the pipeline runs — the long, opaque wait. */}
      {busy && (
        <ScanProgress
          step={status.step}
          plantName={status.plantName}
          detail={status.detail}
          onCancel={() => abortRef.current?.abort()}
        />
      )}

      {/* Not sure enough to be worth drawing. Asks for a better photo rather
          than handing over a creature built on a guess. */}
      {status.kind === 'lowConfidence' && (
        <NotSureDialog
          name={status.name}
          probability={status.probability}
          onRetry={() => setStatus({ kind: 'idle' })}
        />
      )}

      {/* Action row: upload | capture | test */}
      <div className="safe-bottom mt-4 flex items-center justify-around px-8">
        <button
          type="button"
          disabled={busy}
          onClick={() => setIsUploadDialogOpen(true)}
          className="press pixel-button px-3 py-2 text-[9px] disabled:cursor-not-allowed"
        >
          Upload
        </button>

        <button
          type="button"
          aria-label="Capture photo"
          disabled={busy}
          onClick={onCapture}
          className="press flex h-20 w-20 items-center justify-center rounded-full border-4 border-white disabled:opacity-40"
        >
          <span className="h-16 w-16 rounded-full bg-white" />
        </button>

        <button
          type="button"
          disabled={busy}
          onClick={() => void onTestImage()}
          className="press pixel-button px-3 py-2 text-[9px] disabled:cursor-not-allowed"
        >
          Test
        </button>
      </div>

      {/*
        Camera fallback for the capture ring. capture="environment" asks the OS
        for the rear camera directly — the dependable path on a phone when the
        live getUserMedia preview is not available.
      */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          void onFilePicked(event.target.files?.[0], 'mobile');
          event.target.value = '';
        }}
      />

      {isUploadDialogOpen && (
        <UploadDialog
          onCancel={() => setIsUploadDialogOpen(false)}
          onFileAccepted={(file) => {
            setIsUploadDialogOpen(false);
            void onFilePicked(file, 'web');
          }}
        />
      )}

      {status.kind === 'naming' && (
        <NameDialog
          onCancel={() => setStatus({ kind: 'idle' })}
          onSubmit={(name) => void runPipeline(status.photo, status.source, name)}
        />
      )}

      {status.kind === 'done' && (
        <ResultDialog
          sprite={status.sprite}
          name={status.name}
          source={status.source}
          avatarId={status.avatarId}
          avatarDetails={avatarDetails}
          saved={status.saved}
          saveError={status.saveError}
          discovery={status.discovery}
          onBattleNow={() => {
            if (!status.avatarId) return;
            navigate('/battle', {
              state: { avatarId: status.avatarId, avatar: avatarDetails },
            });
          }}
          onGenerateAnother={() => setStatus({ kind: 'idle' })}
          onLeave={() => {
            // Same rule as BackButton: pop history when there is any, else the
            // landing page — a scan opened as a deep link has nothing to pop.
            if (window.history.length > 1) navigate(-1);
            else navigate('/');
          }}
        />
      )}
    </main>
  );
}

/** The scan stages, in order, for the progress stepper. */
const SCAN_STEPS: { key: ScanStep; label: string }[] = [
  { key: 'identify', label: 'Identifying plant' },
  { key: 'sprite', label: 'Creating Plantemon' },
  { key: 'finish', label: 'Finishing the art' },
];

/**
 * Full-screen scan progress: each stage shows a spinner while active, a check
 * once done, and dims until reached. The sub-caption is the pipeline's own
 * per-hop detail line, so it reports what is actually happening.
 */
function ScanProgress({
  step,
  plantName,
  detail,
  onCancel,
}: {
  step: ScanStep;
  plantName?: string;
  detail?: string;
  /** Aborts the run. The overlay is `inset-0 z-30`, so it covers the Back
   *  button — without this the player is pinned to the screen for the length
   *  of a run that can take most of a minute, with no way to leave. */
  onCancel: () => void;
}) {
  const currentIndex = SCAN_STEPS.findIndex((s) => s.key === step);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 p-6">
      <div className="pixel-panel w-full max-w-xs p-5">
        <h2 className="font-pixel text-center text-xs leading-relaxed">
          {plantName ? `Growing ${plantName}` : 'Scanning…'}
        </h2>

        <ol className="mt-5 space-y-4">
          {SCAN_STEPS.map((scanStep, index) => {
            const state =
              index < currentIndex ? 'done' : index === currentIndex ? 'active' : 'pending';
            return (
              <li key={scanStep.key} className="flex items-start gap-3">
                <StepMarker state={state} />
                <div className="min-w-0 flex-1">
                  <p
                    className={`font-pixel text-[10px] leading-relaxed ${
                      state === 'pending' ? 'opacity-40' : ''
                    }`}
                  >
                    {scanStep.label}
                  </p>
                  {state === 'active' && detail && (
                    <p className="pulse-soft mt-1 text-[9px] leading-relaxed opacity-80">
                      {detail}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        <p className="mt-5 text-center text-[9px] leading-relaxed opacity-60">
          This can take up to a minute. Keep the app open.
        </p>

        <button
          type="button"
          onClick={onCancel}
          className="press pixel-button mt-4 w-full px-2 py-2 text-[9px]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

/** The bullet for a step: check when done, spinner when active, dot when pending. */
function StepMarker({ state }: { state: 'done' | 'active' | 'pending' }) {
  if (state === 'done') {
    return (
      <span className="bg-hp-high flex h-5 w-5 shrink-0 items-center justify-center border-2 border-black text-[10px] text-white">
        ✓
      </span>
    );
  }
  if (state === 'active') {
    return (
      <span className="spin mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-black border-t-transparent" />
    );
  }
  return <span className="mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 border-black/40" />;
}

/**
 * The pop-up opened by the Upload button: a drag-and-drop zone plus a Browse
 * File fallback, with real client-side format/size checks (UC6 alt-flow 2a) —
 * the picker's `accept` attribute is only a hint, browsers don't enforce it,
 * so this is the only place that actually rejects a bad file before it ever
 * reaches the pipeline. `size="lg"` on the shared Overlay, since a comfortable
 * dropzone needs more width/padding than the default.
 */
function UploadDialog({
  onFileAccepted,
  onCancel,
}: {
  onFileAccepted: (file: File) => void;
  onCancel: () => void;
}) {
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Counts nested enter/leave pairs rather than toggling a plain boolean.
  // `dragleave` fires on every boundary crossing, including into a child
  // element of this dropzone (its own text/button) — a boolean flicked the
  // highlight off and back on while dragging over those children. Only
  // clearing it once every entered element has also been left keeps the
  // highlight steady for as long as the pointer is anywhere inside the zone.
  const dragDepth = useRef(0);

  function handleFile(file: File | undefined) {
    if (!file) return;
    const error = validateUploadFile(file);
    if (error) {
      setValidationError(error);
      return;
    }
    setValidationError(null);
    onFileAccepted(file);
  }

  return (
    <Overlay size="lg" onDismiss={onCancel} labelledBy="upload-dialog-heading">
      <h2 id="upload-dialog-heading" className="font-pixel text-center text-xs leading-relaxed">
        Upload a plant photo
      </h2>

      <div
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepth.current += 1;
          setIsDraggingOver(true);
        }}
        // Still required even though enter/leave now own the highlight:
        // without preventDefault() here the browser never treats this as a
        // valid drop target, and `drop` never fires at all.
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setIsDraggingOver(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepth.current = 0;
          setIsDraggingOver(false);
          handleFile(event.dataTransfer.files?.[0]);
        }}
        className={`mt-4 flex flex-col items-center gap-3 border-4 border-dashed px-6 py-14 text-center transition-colors ${
          isDraggingOver
            ? 'border-[color:var(--color-brand)] bg-[color:var(--color-brand)]/10'
            : 'border-black/40'
        }`}
      >
        <p className="font-pixel text-[9px] leading-relaxed">Drag a photo here</p>
        <p className="text-[9px] leading-relaxed opacity-70">or</p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="press pixel-button px-3 py-2 text-[9px]"
        >
          Browse File
        </button>
      </div>

      <p className="mt-3 text-center text-[8px] leading-relaxed opacity-60">
        Accepted formats: JPEG, PNG, or WEBP · Maximum size: 5 MB
      </p>

      {validationError && (
        <p
          role="alert"
          className="pixel-panel mt-3 px-3 py-2 text-center text-[9px] leading-relaxed text-red-700"
        >
          {validationError}
        </p>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="press pixel-button mt-4 w-full px-2 py-2 text-[9px]"
      >
        Cancel
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        hidden
        onChange={(event) => {
          handleFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </Overlay>
  );
}

/**
 * "I'm not sure what this is."
 *
 * Shown when Plant.id's confidence falls under MIN_CONFIDENCE_THRESHOLD. The
 * percentage is included because a bare "try again" gives the player nothing to
 * act on, and the advice is specific — flowers and leaves are what the
 * identifier keys on, so "get closer to the flower" is genuinely the fix rather
 * than encouragement.
 */
function NotSureDialog({
  name,
  probability,
  onRetry,
}: {
  name: string;
  probability: number;
  onRetry: () => void;
}) {
  return (
    <Overlay>
      <h2 className="text-center text-xs">Not sure about this one</h2>
      <p className="mt-3 text-[10px] leading-relaxed">
        The closest match was <em>{name}</em>, but only {Math.round(probability * 100)}%
        confident — not enough to grow a plant from.
      </p>
      <p className="mt-2 text-[9px] leading-relaxed opacity-80">
        Try again with a clearer photo: fill the frame with one plant, get close to a
        flower or leaf, and keep it in focus and well lit.
      </p>
      <button
        type="button"
        onClick={onRetry}
        style={{ background: 'var(--color-hp-high)', color: '#fff' }}
        className="press pixel-button mt-4 w-full px-2 py-2 text-[9px]"
      >
        Scan again
      </button>
    </Overlay>
  );
}

/** Port of ScanActivity.showNameDialog. */
function NameDialog({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState('');

  return (
    <Overlay>
      <h2 className="text-xs">Name this plant</h2>
      <p className="mt-2 text-[9px] leading-relaxed opacity-80">
        Couldn&apos;t identify it automatically. What would you like to call it?
      </p>
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="e.g. Rose, Sunflower…"
        className="mt-3 w-full border-2 border-black px-2 py-2 text-[10px]"
      />
      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onSubmit(name)}
          className="press pixel-button flex-1 px-2 py-2 text-[9px]"
        >
          Generate
        </button>
        <button type="button" onClick={onCancel} className="press pixel-button px-2 py-2 text-[9px]">
          Cancel
        </button>
      </div>
    </Overlay>
  );
}

function ResultDialog({
  sprite,
  name,
  source,
  avatarId,
  avatarDetails,
  saved,
  saveError,
  discovery,
  onBattleNow,
  onGenerateAnother,
  onLeave,
}: {
  sprite: string;
  name: string;
  /** Decides whether the Web Upload badge + 24h expiry line show at all — an
   *  IRL (camera) scan is permanent, so neither applies (RetentionNote in
   *  ArchivePage.tsx follows the same rule: silent for a mobile-sourced
   *  avatar, only web uploads carry an expiry). */
  source: CaptureSource;
  avatarId: string | null;
  /** The real persisted record (species/family/full stats), fetched
   *  separately — see the effect that populates this in ScanPage. Null while
   *  loading, or if the fetch failed; the dialog just omits that section
   *  rather than showing anything fake. */
  avatarDetails: PlantAvatarData | null;
  saved: boolean;
  saveError?: string;
  discovery: ScanDiscovery | null;
  onBattleNow: () => void;
  /** Returns to the viewfinder for another run — the dialog's dismiss action. */
  onGenerateAnother: () => void;
  /** Leaves the scan screen, the way the page's own Back button does. */
  onLeave: () => void;
}) {
  const navigate = useNavigate();

  return (
    /*
     * Dismissing returns to the viewfinder rather than leaving the screen. The
     * scan is already persisted by the time this shows — `saved` reports
     * whether that worked — so closing costs nothing, and a backdrop press that
     * navigated away would be a surprising way to lose a sprite in the one case
     * where it is only in the browser.
     */
    <Overlay onDismiss={onGenerateAnother} labelledBy="scan-result-title">
      {/*
        grid-cols-[1fr_auto_1fr], not flex + flex-1: ← Back and × are
        different widths, so centering the heading in whatever space is left
        over after two unequal-width flex siblings put it visibly off-centre
        toward the narrower side. Two equal 1fr side columns guarantee the
        auto middle column — and the heading inside it — sits at the row's
        true centre regardless of what the side buttons contain.
      */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        <button
          type="button"
          onClick={onLeave}
          className="press pixel-button justify-self-start px-2 py-1 text-[9px]"
        >
          ← Back
        </button>
        <h2 id="scan-result-title" className="text-center text-xs">
          New Discovery!
        </h2>
        {/*
          Two different exits, so both are offered: ← Back leaves the scan
          screen, × returns to the viewfinder for another run. The × sits in
          the slot that used to hold a balancing spacer rather than being
          absolutely positioned, so it cannot land on top of the heading.
        */}
        <button
          type="button"
          onClick={onGenerateAnother}
          aria-label="Close"
          className="press pixel-button pixel-button-icon flex h-6 w-6 shrink-0 items-center justify-center justify-self-end text-sm leading-none"
        >
          ×
        </button>
      </div>

      <div className="scan-result-glow relative mx-auto mt-3 h-40 w-40">
        <img src={sprite} alt="" className="pixelated relative z-10 h-40 w-40 object-contain" />
      </div>
      <p className="mt-2 text-center text-[10px] leading-relaxed">{name}</p>
      {avatarDetails?.family && (
        <p className="text-center text-[9px] leading-relaxed opacity-70">
          {avatarDetails.species} from {avatarDetails.family}
        </p>
      )}

      <p className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
        <CaptureBadge source={source} />
        {source === 'web' && (
          <span className="text-[9px] leading-relaxed opacity-70">
            Expires 24 hours after upload
          </span>
        )}
      </p>

      {avatarDetails && (
        <div className="mt-3">
          <StatGrid avatar={avatarDetails} compact />
        </div>
      )}

      <p
        className={
          saved
            ? 'mt-3 text-center text-[9px] leading-relaxed opacity-80'
            : 'pixel-panel mt-3 px-3 py-2 text-center text-[9px] leading-relaxed text-red-700'
        }
      >
        {saved
          ? 'Saved to your archive.'
          : `Your plant was generated, but it could not be saved.${saveError ? ` ${saveError}` : ''}`}
      </p>

      {discovery &&
        (discovery.isFirstDiscoverer ? (
          <p className="mt-3 text-center text-[9px] leading-relaxed">
            You discovered this first!
          </p>
        ) : (
          <div className="mt-3 text-center text-[9px] leading-relaxed">
            <p>First discovered by {discovery.firstDiscoveredByName}</p>
            {/* Scans, not scanners — see ScanDiscovery. */}
            <p>Scanned {discovery.discoveryCount} times</p>
          </div>
        ))}

      {/* Battling needs a real, saved avatarId — nothing to load in a battle
          if the save itself failed. Takes the primary slot because it is the
          thing a player most likely wants next from a fresh discovery. */}
      {saved && avatarId && (
        <button
          type="button"
          onClick={onBattleNow}
          className="press pixel-button is-primary mt-4 w-full px-2 py-2 text-[9px]"
        >
          Battle Now
        </button>
      )}

      {/* Only when the record exists: sending someone to the archive to admire
          a plant that failed to save would be a worse answer than the error
          above it. */}
      {saved && (
        <button
          type="button"
          onClick={() => navigate('/archive')}
          className="press pixel-button mt-2 w-full px-2 py-2 text-[9px]"
        >
          See it in your archive
        </button>
      )}

      <button
        type="button"
        onClick={onGenerateAnother}
        className="press pixel-button mt-2 w-full px-2 py-2 text-[9px]"
      >
        Generate Another
      </button>

      {/* Promoted to primary when the save failed: the download is then the
          only way the player keeps this sprite at all. */}
      <a
        href={sprite}
        download={`${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`}
        className={`press pixel-button mt-2 block w-full px-2 py-2 text-center text-[9px]${
          saved ? '' : ' is-primary'
        }`}
      >
        Download Sprite
      </a>
    </Overlay>
  );
}

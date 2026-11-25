"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { fetchHealth, streamDraw } from "@/lib/api";
import { EtchEngine, type Stroke } from "@/lib/engine";
import { Receipt, type ReceiptData } from "./receipt";
import { Screen } from "./screen";

type Status = "idle" | "planning" | "imaging" | "drawing" | "done" | "error";
type View = "drawing" | "thinking";

const SHAKE_MS = 500;
/** How long the submitted prompt takes to fade from the screen. Matches `.prompt-field.is-fading`. */
const PROMPT_FADE_MS = 2600;
/** Canvas units per second. There is no speed control any more. */
const DRAW_SPEED = 3000;

export function DreamSketcher() {
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const stylus = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const engine = useRef<EtchEngine | null>(null);
  const request = useRef<AbortController | null>(null);
  const streamFinished = useRef(true);
  /** Every stroke sent to the screen since it was last cleared, so the picture can be repainted. */
  const strokes = useRef<Stroke[]>([]);

  const [text, setText] = useState("");
  /** True while a submitted prompt is fading away; the field is read-only until it has gone. */
  const [fading, setFading] = useState(false);
  const [view, setView] = useState<View>("drawing");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptData | null>(null);
  const [shaking, setShaking] = useState(false);
  /** undefined until the backend has answered; null if it has no API key. */
  const [provider, setProvider] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!canvas.current || !stylus.current) return;
    const instance = new EtchEngine(
      { canvas: canvas.current, stylus: stylus.current },
      {
        onIdle: () => {
          if (streamFinished.current) setStatus((current) => (current === "drawing" ? "done" : current));
        },
      },
    );
    instance.speed = DRAW_SPEED;
    engine.current = instance;
    // A new canvas element starts blank. If a drawing was on the old one, put it back.
    if (strokes.current.length > 0) {
      instance.replay(strokes.current);
      if (streamFinished.current) setStatus((current) => (current === "drawing" ? "done" : current));
    }
    return () => {
      instance.dispose();
      engine.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetchHealth(controller.signal)
      .then((health) => setProvider(health.provider))
      .catch(() => setProvider(undefined));
    return () => controller.abort();
  }, []);

  useEffect(() => () => request.current?.abort(), []);

  // Once a dream is sent the caret goes away and stays away, so nothing blinks over the
  // drawing. The screen is still the only thing to type into: just start typing (or click
  // it) and the caret comes back with the first letter.
  useEffect(() => {
    if (view !== "drawing" || fading) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
      if (document.activeElement === field.current) return;
      field.current?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, fading]);

  /** Plays the shake, then wipes the screen. */
  const shake = useCallback(async (): Promise<void> => {
    request.current?.abort();
    engine.current?.stop();
    setShaking(true);
    await new Promise((resolve) => setTimeout(resolve, SHAKE_MS));
    engine.current?.clear();
    strokes.current = [];
    setShaking(false);
  }, []);

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const dream = text.trim();
      if (!dream || fading || !engine.current) return;

      // The words fade slowly from the screen, then the field is ready for the next dream.
      field.current?.blur();
      setFading(true);
      setTimeout(() => {
        setText("");
        setFading(false);
      }, PROMPT_FADE_MS);

      // You would shake a real one before starting a new picture.
      if (engine.current.hasInk || engine.current.busy) await shake();
      else request.current?.abort();

      const controller = new AbortController();
      request.current = controller;
      streamFinished.current = false;
      setStatus("planning");
      setError(null);
      setReceipt({ dream, parts: [] });

      const update = (change: (previous: ReceiptData) => ReceiptData): void => {
        setReceipt((previous) => (previous ? change(previous) : previous));
      };

      try {
        for await (const drawEvent of streamDraw({ text: dream }, controller.signal)) {
          if (controller.signal.aborted) return;
          switch (drawEvent.type) {
            case "plan":
              update((previous) => ({ ...previous, plan: drawEvent }));
              break;
            case "scene":
              setStatus("imaging");
              update((previous) => ({ ...previous, scene: drawEvent.scene }));
              break;
            case "image":
              update((previous) => ({ ...previous, image: drawEvent }));
              break;
            case "part":
              setStatus("drawing");
              for (const stroke of [
                { kind: "connector", points: drawEvent.connector },
                { kind: "part", points: drawEvent.points, partId: drawEvent.partId, name: drawEvent.name },
              ] satisfies Stroke[]) {
                if (stroke.points.length === 0) continue;
                strokes.current.push(stroke);
                engine.current?.enqueue(stroke);
              }
              update((previous) => ({ ...previous, parts: [...previous.parts, drawEvent] }));
              break;
            case "done":
              update((previous) => ({ ...previous, totalMs: drawEvent.durationMs }));
              break;
            case "error":
              throw new Error(drawEvent.message);
          }
        }
        streamFinished.current = true;
        if (!engine.current?.busy) setStatus((current) => (current === "drawing" ? "done" : current));
      } catch (caught) {
        if (controller.signal.aborted) return;
        streamFinished.current = true;
        const message = caught instanceof Error ? caught.message : String(caught);
        setError(message === "Failed to fetch" ? "Could not reach the backend. Is `bun dev` running?" : message);
        setStatus("error");
        update((previous) => ({ ...previous, failed: true }));
      }
    },
    [fading, shake, text],
  );

  const showView = useCallback((next: View) => {
    setView(next);
    window.scrollTo({ top: 0 });
  }, []);

  const hasDrawing = (receipt?.parts.length ?? 0) > 0;
  // Typing a new dream over a finished drawing: fade the drawing back so the words read clearly.
  const dimmed = hasDrawing && text.length > 0 && !fading;

  const placeholder = receipt ? "" : "Describe your dream…";

  // No progress text: the screen stays quiet while it works. Only a failure, or a
  // missing API key, is worth interrupting for, since otherwise nothing would ever appear.
  const problem = error ?? (status === "idle" && provider === null ? "No API key is set. Add OPENROUTER_API_KEY to backend/.env and restart." : null);

  return (
    <main className="min-h-dvh">
      {/* Drawing: the screen, dead centre. It stays mounted (only hidden) in the thinking view, so the pen keeps moving. */}
      <div className={view === "drawing" ? "flex min-h-dvh items-center justify-center p-6" : "hidden"}>
        {/* As large as fits: limited by the width, by 900px, and by the height left above the pill. */}
        <div className="w-full" style={{ maxWidth: "min(900px, calc((100dvh - 9rem) * 10 / 7))" }}>
          <Screen refs={{ canvas, stylus }} shaking={shaking} dimmed={dimmed}>
            <form
              onSubmit={onSubmit}
              onClick={() => field.current?.focus()}
              className="absolute inset-0 flex cursor-text items-center justify-center px-[10%] py-[8%]"
            >
              {/* The field shrinks to fit its words (or the placeholder) and that block is
                  centred, with the text inside it left-aligned. So an empty field's caret sits
                  at the start of the placeholder, not in the middle of it. The hidden mirror
                  span is what gives the block its size. */}
              <div className="prompt-sizer">
                <span aria-hidden className="prompt-mirror">
                  {text || placeholder}
                  {"\u200b"}
                </span>
                <textarea
                  ref={field}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    // Enter draws; Shift+Enter adds a line. Leave Enter alone while an IME is composing.
                    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  readOnly={fading}
                  placeholder={placeholder}
                  rows={1}
                  maxLength={2000}
                  autoFocus
                  spellCheck={false}
                  aria-label="Describe your dream. Press Enter to draw."
                  className={`prompt-field resize-none overflow-hidden bg-transparent outline-none placeholder:text-faint ${fading ? "is-fading" : ""}`}
                />
              </div>
            </form>
            {problem && (
              <p role="alert" className="pointer-events-none absolute inset-x-[6%] bottom-[5%] text-center text-muted">
                {problem}
              </p>
            )}
          </Screen>
        </div>
      </div>

      {/* Thinking: the receipt of how the drawing was made. */}
      {view === "thinking" && receipt && (
        <>
          <div className="mx-auto w-full max-w-[766px] px-6 pb-48 pt-16 sm:px-10">
            <Receipt data={receipt} speed={DRAW_SPEED} />
          </div>
          {/* The same soft edge as the drawing, pinned to the top and bottom of the
              window, so the text blurs and fades away as it scrolls out of view. */}
          <div aria-hidden className="scroll-veil is-top" />
          <div aria-hidden className="scroll-veil is-bottom" />
        </>
      )}

      {/* Appears once the first dream is sent, and stays. */}
      {receipt && (
        <div role="tablist" aria-label="View" data-view={view} className="view-pill fixed bottom-6 left-1/2 z-10">
          {/* The dark marker that slides under whichever option is selected. */}
          <span aria-hidden className="view-pill-thumb" />
          {(["drawing", "thinking"] as const).map((option) => (
            <button key={option} type="button" role="tab" aria-selected={view === option} onClick={() => showView(option)}>
              {option === "drawing" ? "Drawing" : "Thinking"}
            </button>
          ))}
        </div>
      )}
    </main>
  );
}

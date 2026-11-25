"use client";

import { memo, type ReactNode } from "react";
import type { CanvasPoint, DrawEvent, Scene } from "@etch/backend";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@/lib/engine";

export type PlanEvent = Extract<DrawEvent, { type: "plan" }>;
export type ImageEvent = Extract<DrawEvent, { type: "image" }>;
export type PartEvent = Extract<DrawEvent, { type: "part" }>;

/** Everything one run reported, gathered as the events arrive. */
export interface ReceiptData {
  dream: string;
  plan?: PlanEvent;
  scene?: Scene;
  /** The one finished picture. */
  image?: ImageEvent;
  /** The parts of it traced so far, in drawing order. */
  parts: PartEvent[];
  totalMs?: number;
  failed?: boolean;
}

// ---- formatting -----------------------------------------------------------

const seconds = (ms: number): string => `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
const whole = (value: number): string => Math.round(value).toLocaleString("en-GB");
const money = (usd: number): string => `$${usd.toFixed(usd < 0.1 ? 4 : 2)}`;

function clock(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")} s`;
}

// ---- building blocks ------------------------------------------------------

function Step({ number, title, meta, summary, children }: { number: string; title: string; meta?: string[]; summary: string; children?: ReactNode }) {
  return (
    <li className="receipt-step grid grid-cols-[2.6rem_minmax(0,1fr)] gap-x-2 pb-[3.2em] last:pb-0">
      <span className="text-muted tabular-nums">{number}</span>
      <div className="flex min-w-0 flex-col gap-[0.9em]">
        <div>
          <p>{title}</p>
          {meta && meta.length > 0 && <p className="text-muted">{meta.join(" · ")}</p>}
          <p className="mt-[0.4em] max-w-[62ch] text-muted">{summary}</p>
        </div>
        {children}
      </div>
    </li>
  );
}

function Waiting({ children }: { children: ReactNode }) {
  return <p className="receipt-waiting text-muted">{children}</p>;
}

function Raw({ label, children }: { label: string; children: string }) {
  return (
    <details>
      <summary>{label}</summary>
      <pre className="receipt-raw is-boxed mt-[0.6em]">{children}</pre>
    </details>
  );
}

function LineItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-x-6">
      <span className="text-muted">{label}</span>
      <span className="text-right tabular-nums">{value}</span>
    </div>
  );
}

const frame = `0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`;
const toPoints = (points: readonly CanvasPoint[]): string => points.map(([x, y]) => `${x},${y}`).join(" ");

/** One traced path on the full canvas, so its placement is visible too. */
const PathThumb = memo(function PathThumb({ points, label }: { points: CanvasPoint[]; label: string }) {
  return (
    <svg viewBox={frame} role="img" aria-label={label} className="block w-full border border-line">
      <polyline points={toPoints(points)} fill="none" stroke="var(--color-body)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
});

/** Every part in grey with the moves between them picked out. */
const LinkMap = memo(function LinkMap({ parts }: { parts: PartEvent[] }) {
  return (
    <svg viewBox={frame} role="img" aria-label="The moves between parts" className="block w-full border border-line">
      {parts.map((part) => (
        <polyline key={part.partId} points={toPoints(part.points)} fill="none" stroke="var(--color-line)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      ))}
      {parts.map((part) =>
        part.connector.length > 1 ? (
          <polyline key={part.partId} points={toPoints(part.connector)} fill="none" stroke="var(--color-link)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ) : null,
      )}
    </svg>
  );
});

/** Where the planner said each part sits in the picture. */
function LayoutMap({ scene }: { scene: Scene }) {
  return (
    <svg viewBox="0 0 1000 667" role="img" aria-label="Part boxes on the picture" className="block w-full border border-line">
      {scene.parts.map((part, index) => {
        const x = part.bbox.x * 1000;
        const y = part.bbox.y * 667;
        return (
          <g key={part.id}>
            <rect
              x={x}
              y={y}
              width={part.bbox.w * 1000}
              height={part.bbox.h * 667}
              fill="none"
              stroke="var(--color-muted)"
              strokeWidth={1}
              strokeDasharray={index === 0 ? "6 5" : undefined}
              vectorEffect="non-scaling-stroke"
            />
            <text x={x + 14} y={y + 62} fontSize={58} fill="var(--color-body)">
              {index + 1}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---- the receipt ----------------------------------------------------------

/**
 * A step-by-step record of one run: what was sent to each model, what came
 * back, and what the code did with it. A step is only shown once the run has
 * reached it, so while a drawing is being made the page holds just the steps
 * that are under way or done, and grows as each new one starts.
 */
export function Receipt({ data, speed }: { data: ReceiptData; speed: number }) {
  const { plan, scene, image, parts } = data;
  const partCount = scene?.parts.length ?? 0;
  const planCost = plan?.usage?.costUsd;
  const imageCost = image?.usage?.costUsd;
  const anyCost = planCost !== undefined || imageCost !== undefined;

  const totalPoints = parts.reduce((sum, part) => sum + part.points.length + part.connector.length, 0);
  const drawLength = parts.reduce((sum, part) => sum + part.trace.length, 0);
  const linkLength = parts.reduce((sum, part) => sum + part.trace.link.retraced + part.trace.link.hop, 0);
  const traceMs = parts.reduce((sum, part) => sum + part.trace.traceMs, 0);
  const finished = data.totalMs !== undefined;

  return (
    <section className="receipt text-left" aria-label="How this drawing was made">
      <ol>
        <Step number="01" title="Your prompt" summary="Sent as it is to the backend, which runs the steps below and streams each result back.">
          <p className="receipt-raw">{data.dream}</p>
        </Step>

        <Step
          number="02"
          title="Scene planner"
          meta={plan ? [plan.model] : undefined}
          summary="A language model reads the prompt and decides on one picture: a title, a description of the whole image, and the parts of it to draw in order, each with a rough box and a line of narration."
        >
          {!plan || !scene ? (
            !data.failed && <Waiting>Planning the picture…</Waiting>
          ) : (
            <>
              <p>
                <span className="mr-[0.7em] text-muted">Title</span>
                {scene.title}
              </p>
              <div>
                <p className="text-muted">The picture, as described for the image model</p>
                <p className="receipt-raw">{scene.prompt}</p>
              </div>
              <div className="grid gap-x-6 gap-y-[1.2em] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
                <div>
                  <LayoutMap scene={scene} />
                  <p className="mt-[0.4em] text-muted">Where each part should be. Part 1 is dashed.</p>
                </div>
                <ol className="flex flex-col gap-[0.9em]">
                  {scene.parts.map((part, index) => (
                    <li key={part.id} className="grid grid-cols-[1.4rem_minmax(0,1fr)]">
                      <span className="text-muted tabular-nums">{index + 1}</span>
                      <div>
                        <p>{part.name}</p>
                        <p className="receipt-raw text-muted">{part.narration}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
              <Raw label="Instructions sent to the model">{plan.system}</Raw>
              <Raw label="Raw reply">{plan.reply}</Raw>
            </>
          )}
        </Step>

        {scene && (
          <Step
            number="03"
            title="The picture"
            meta={image ? [image.model] : undefined}
            summary="The description, with the house style added to it, goes to an image model once. It returns one finished picture, so everything in it already fits together."
          >
            {!image ? (
              !data.failed && <Waiting>Making the picture…</Waiting>
            ) : (
              <>
                <figure>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.image} alt="The picture the image model made" className="block w-full border border-line" />
                  <figcaption className="mt-[0.4em] text-muted">
                    {[image.shape, `${image.width}×${image.height}`, image.quality, seconds(image.durationMs)].filter(Boolean).join(" · ")}
                  </figcaption>
                </figure>
                <details>
                  <summary>Prompt sent, with the house style</summary>
                  <p className="receipt-raw mt-[0.4em]">{image.prompt}</p>
                </details>
              </>
            )}
          </Step>
        )}

        {image && (
          <Step
            number="04"
            title="Split and trace"
            meta={parts.length > 0 ? [`${parts.length} of ${partCount} traced`, `${whole(traceMs)} ms`] : undefined}
            summary="No model here. The whole picture is thinned to the centre of its lines and traced as one network of strokes, so nothing is cut. Each stroke goes to the part whose box it lies in. To join a part up, the pen travels along other lines of the picture instead of striking out across blank paper. The split only sets the order of drawing; it cannot change the picture."
          >
            {parts.length === 0 ? (
              !data.failed && <Waiting>Tracing…</Waiting>
            ) : (
              <ul className="flex flex-col gap-[1.6em]">
                {parts.map((part) => {
                  const { trace } = part;
                  const index = scene ? scene.parts.findIndex((p) => p.id === part.partId) + 1 : 0;
                  return (
                    <li key={part.partId} className="flex flex-col gap-[0.5em]">
                      <p>
                        <span className="mr-[0.5em] text-muted tabular-nums">{index}</span>
                        {part.name}
                      </p>
                      <div className="grid grid-cols-2 gap-x-4">
                        <figure>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={trace.seen} alt={`This part of the picture: ${part.name}`} className="block w-full border border-line" />
                          <figcaption className="mt-[0.3em] text-muted">Its share of the picture</figcaption>
                        </figure>
                        <figure>
                          <PathThumb points={part.points} label={`Traced path for ${part.name}`} />
                          <figcaption className="mt-[0.3em] text-muted">Traced path</figcaption>
                        </figure>
                      </div>
                      <p className="text-muted">{[`${whole(trace.points)} points`, `${whole(trace.length)} units`, `${trace.traceMs} ms`].join(" · ")}</p>
                    </li>
                  );
                })}
              </ul>
            )}
          </Step>
        )}

        {parts.length > 0 && (
          <Step
            number="05"
            title="Link the parts"
            meta={parts.length > 1 ? [`${whole(linkLength)} units of travel`] : undefined}
            summary="The pen cannot lift. To reach each new part it first retraces lines already on the screen, then makes one straight hop across blank space. Those moves are shown in blue."
          >
            <div className="grid gap-x-6 gap-y-[1em] sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
              <LinkMap parts={parts} />
              <div className="flex flex-col gap-[0.3em]">
                {parts.map((part, index) =>
                  index === 0 ? (
                    <LineItem key={part.partId} label={`Start at ${part.name}`} value="pen down" />
                  ) : (
                    <LineItem key={part.partId} label={`To ${part.name}`} value={`retrace ${whole(part.trace.link.retraced)} + hop ${whole(part.trace.link.hop)}`} />
                  ),
                )}
              </div>
            </div>
          </Step>
        )}

        {finished && (
          <Step number="06" title="Total" summary="What this drawing took.">
            <div className="flex max-w-[30rem] flex-col gap-[0.3em]">
              {plan && <LineItem label="Planner call" value={[seconds(plan.durationMs), ...(planCost !== undefined ? [money(planCost)] : [])].join(" · ")} />}
              {image && <LineItem label="Image call" value={[seconds(image.durationMs), ...(imageCost !== undefined ? [money(imageCost)] : [])].join(" · ")} />}
              <LineItem label="Tracing and linking" value={`${whole(traceMs)} ms`} />
              {data.totalMs !== undefined && <LineItem label="Backend time, start to finish" value={seconds(data.totalMs)} />}
              {anyCost && <LineItem label="Model cost" value={money((planCost ?? 0) + (imageCost ?? 0))} />}
              <LineItem label="Points in the line" value={whole(totalPoints)} />
              <LineItem label="Line length" value={`${whole(drawLength + linkLength)} units`} />
              <LineItem label={`Time to draw at speed ${whole(speed)}`} value={clock((drawLength + linkLength) / speed)} />
            </div>
          </Step>
        )}
      </ol>
    </section>
  );
}

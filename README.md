# etch

Type a description of a dream and an on-screen Etch A Sketch draws it as a
single continuous line, in a style of its own.

This is a browser simulation. The path it produces is the same data that will
later drive two stepper motors (one per knob) through GRBL, so the pipeline
already obeys the toy's one rule: **the pen never lifts**. Every move between
two points is drawn, including the moves between parts of the picture.

## Run it

```bash
bun install
bun dev
```

That starts the backend on <http://localhost:8787> and the frontend on
<http://localhost:3000>. Open the frontend, describe a dream, press **Draw**.

A model API key is required: copy `backend/.env.example` to `backend/.env` and
set `OPENROUTER_API_KEY` (or `OPENAI_API_KEY`). There is no offline fallback;
without a key the page says so and `POST /draw` answers 503. Restart `bun dev`
after changing `.env`.

Below the screen the page prints a receipt of the run: the prompt, the
planner's instructions and raw reply, the image prompt and the picture it
produced, how that picture was divided into parts, the traced paths, the moves
between parts, and time and cost.

Other commands, all from the repo root:

| Command | What it does |
| --- | --- |
| `bun test` | Unit tests for the image maths, linker, G-code and the `/draw` stream |
| `bun run typecheck` | Strict TypeScript over both apps |
| `bun run preview "a house by the sea" > out.svg` | Runs the pipeline and writes an SVG (connectors in red) |
| `bun run preview --gcode "a cat" > out.gcode` | Same, but writes G-code |
| `bun run preview --style hatch "a mountain"` | Traces the picture another way (`line` is the default) |
| `bun run preview --image picture.webp "a cat" > out.svg` | Also saves the picture the image model made |

### The look

The frontend is deliberately plain: a hairline rectangle for the screen, text
controls, one typeface: ABC Stefan (Dinamo), in
`frontend/public/fonts/ABCStefan-Simple-Trial.otf`. That file is the trial
cut, so it needs a licence before the site is published.

## Layout

```
etch/
├── scripts/dev.ts            starts both apps
├── backend/                  Bun + Hono, no database, nothing written to disk
│   ├── src/
│   │   ├── app.ts            routes; exports AppType for the frontend
│   │   ├── index.ts          server entry
│   │   ├── config.ts         picks providers from the environment
│   │   ├── types.ts          zod schemas: Scene, DrawRequest, DrawEvent
│   │   ├── pipeline/         one module per stage (see below)
│   │   ├── providers/        openrouter.ts, openai.ts
│   │   └── geometry/         the image maths, plain TypeScript
│   ├── scripts/preview.ts
│   └── test/
└── frontend/                 Next.js (App Router) + React + Tailwind
    ├── app/
    ├── components/           screen.tsx, dream-sketcher.tsx
    └── lib/                  api.ts (typed client), engine.ts (animation)
```

### End-to-end types

The backend chains its routes on one Hono instance and exports
`AppType`. The frontend builds its client with `hc<AppType>()` from
`hono/client`, so the path and JSON body (`text`, `styleOverride`) of `POST /draw` are checked at compile time on both sides, and the
`DrawEvent` union is imported from the backend rather than re-declared. The
import is type-only: no backend code ships to the browser.

## Pipeline

Each stage is its own module behind a small interface in
`backend/src/pipeline/`.

| # | Stage | Module | Interface |
| --- | --- | --- | --- |
| 1 | Input | `input.ts` | `DreamInput`, `SpeechToText` |
| 2 | Scene planner | `planner.ts` | `ScenePlanner` |
| 3 | The picture | `image.ts`, `style.ts` | `SceneImageGenerator`, `HOUSE_STYLE` |
| 4 | Raster to path | `raster.ts`, `compose.ts`, `vectorise.ts` | `loadRaster`, `splitIntoParts`, `rasterToPath` |
| 5 | Linking | `link.ts` | `Linker` |
| 6 | Output | `run.ts`, `geometry/gcode.ts` | `runPipeline`, `toGcode` |

1. **Input.** Text for now. `SpeechToText` and `speechInput()` are the stub
   for voice.
2. **Scene planner.** An LLM turns the dream into a `Scene`: a title, a
   description of ONE whole picture, and 3 to 6 parts of that picture in the
   order to draw them, each with a rough box and a line of narration. It is
   told to distil the dream rather than illustrate it. The reply is validated
   with zod and tidied by `normaliseScene`.
3. **The picture.** One image-model call makes the whole finished picture, at
   high quality, in landscape. The prompt is the planner's description plus
   the house style.

   **The house style lives in `backend/src/pipeline/style.ts`** (`HOUSE_STYLE`).
   It is what gives every drawing the same hand: an abstract continuous-line
   drawing, forms reduced to bare gestures, volume shown by echo contours, a
   lot of empty paper. Edit that one constant to change the look of
   everything. It also keeps the image traceable: even black line on white,
   no fills.
4. **Raster to path.** `sharp` decodes, greyscales and resizes to 1024 px on
   the long side; from there it is plain TypeScript in `geometry/`:
   - Otsu threshold to an ink mask.
   - `line` (the default, `traceLineParts`): Zhang–Suen thinning of the WHOLE
     picture, then one graph of it (nodes at junctions and endpoints, edges as
     pixel chains, each smoothed and simplified). Each edge is given to the
     part whose box holds its midpoint (the smallest such box, or the nearest).
     A part's edges are joined to each other, and to what is already drawn, by
     shortest paths along the picture's own lines, which just get drawn early
     or twice. Each part is then walked as a closed Euler circuit (cheapest
     edges duplicated, Hierholzer), so the pen can enter it at a point that is
     already on the screen.
   - The parts come from one image, so they always fit together; the split
     only decides the order of drawing and where the narration changes. A
     planner box that misses does not harm the picture.
   - `tsp`, `hatch`, `spiral`: tonal alternatives, chosen with
     `styleOverride`. Stippling joined by a travelling-salesman tour, tonal
     cross-hatching, and a spiral whose radius wobbles with darkness.
   - Ramer–Douglas–Peucker, then fit the whole picture inside the canvas.
5. **Linking.** The `Linker` keeps a graph of everything drawn so far.
   For each new part it runs Dijkstra from the stylus over the existing
   lines, picks where on the new part to start (either end, or any vertex of
   a closed shape), and returns a connector: a retrace along old lines, then
   the shortest straight hop. Retracing is weighted cheaper than new ink.
6. **Output.** Points in a fixed 1000 x 700 space, streamed as events.
   `toGcode(points, opts)` converts the same points to `G1 X.. Y.. F..` in
   millimetres (origin bottom-left, Y flipped) with an optional
   `reversalCompensation` for knob backlash. The UI does not use it yet.

## API

`POST /draw` with `{ "text": string, "styleOverride"?: "line" | "tsp" | "hatch" | "spiral" }`
streams newline-delimited JSON:

```ts
{ type: "plan", provider, model, system, user, reply, attempts, durationMs, usage? }
{ type: "scene", scene: Scene }
{ type: "image", provider, model, prompt, shape, durationMs, width, height, image, usage? }
{ type: "part", partId, name, narration, points, connector, trace: PartTrace }
{ type: "done", durationMs }
{ type: "error", message: string }
```

`plan` and `image` are receipts of the two model calls. There is one `image`
and then one `part` per region of it. `connector` runs from the end of the
previous part to `points[0]` and is empty for the first part. `trace` records
what splitting, tracing and linking did for the part. The full types are in
`backend/src/types.ts`. `GET /health` reports the provider and models in use.
CORS allows `CORS_ORIGIN` (default `http://localhost:3000`).

## Swapping providers and going offline

`backend/src/config.ts` is the only place that chooses implementations.
`ETCH_PROVIDER` is `auto` (OpenRouter if `OPENROUTER_API_KEY` is set, then
OpenAI if `OPENAI_API_KEY` is set), or `openrouter` or `openai` to force one.

| Provider | Planner | Images | Defaults |
| --- | --- | --- | --- |
| `openrouter` | `POST /chat/completions` | `POST /images` | `anthropic/claude-sonnet-5.5`, `openai/gpt-image-2` |
| `openai` | `POST /chat/completions` (JSON mode) | `POST /images/generations` | `gpt-4.1-mini`, `gpt-image-1` |

With OpenRouter you can swap either model from `.env` without code changes:
any chat slug for `OPENROUTER_TEXT_MODEL`, and any slug listed by
`https://openrouter.ai/api/v1/images/models` for `OPENROUTER_IMAGE_MODEL`.

To add a provider, implement the interface and return it from
`providersFromEnv`:

- **Whisper / whisper.cpp:** implement `SpeechToText.transcribe(audio, mimeType)`
  in `pipeline/input.ts` (replace `WhisperSpeechToText`), add an upload route
  in `app.ts`, and pass `speechInput(audio, mime, stt)` where `textInput` is
  used today.
- **llama.cpp or another LLM:** implement `ScenePlanner.plan(text)`,
  returning the scene and a receipt of the call.
  Reuse the instructions in `providers/openai.ts` and finish with
  `normaliseScene(json)`. Any server that speaks the OpenAI chat API works
  already via `OPENAI_BASE_URL` and `OPENAI_TEXT_MODEL`.
- **Quick, Draw! or another image source:** implement
  `SceneImageGenerator.generate(scene, style)` and return image bytes. For stroke
  data you can rasterise it, or skip stages 3 and 4 and feed strokes straight
  to the `Linker`. Return a receipt alongside the bytes so the page can show
  what was asked for.

## Notes and limits

- The OpenRouter provider has been run live. The OpenAI-direct provider is
  only covered by tests with a stubbed network.
- Strokes are shared out by the planner's boxes, which are guesses made before
  the picture exists, so a part can include a few strokes of its neighbour.
- A straight line is only invented where the picture itself has a gap (two
  things that do not touch); it is the shortest one that closes the gap.
- Something alone in the sky (a moon) has to be reached by a visible straight
  line, because the pen cannot lift.
- The linker only switches between lines at shared vertices, so two lines that
  cross mid-segment are not treated as a junction.
- The first part starts wherever its path starts; on hardware you will want a
  connector from the homed position.
- Starting a new drawing shakes the screen first. The stylus keeps its place,
  as on the real toy, and the gap to the new drawing is drawn.

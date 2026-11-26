import type { Style } from "../types";

/**
 * The house style: how every etch drawing looks, whatever the dream.
 *
 * This is the one place to change it. The planner is told about it so that it
 * composes for it, and it is appended to every image prompt.
 *
 * It has one job: taste. The image model draws the rough pencil sketch
 * itself, with its searching lines, construction marks and faint and firm
 * strokes, because a real sketch is loose where the form is uncertain and no
 * filter added afterwards can know where that is. The tracer is built to keep
 * all of it (`sketchMask`, `pressureStrokes`); it only needs black pencil on
 * white paper, with no wash or smudging.
 */
export const HOUSE_STYLE = [
  "A fast, rough gesture drawing in black pencil on plain white paper, done from memory in about a minute by someone who draws every day.",
  "The lines search for the form: contours are drawn two or three times, loosely, never in quite the same place. Some lines are pressed hard and dark, most are light and faint.",
  "Construction marks are left in: rough circles for heads, hands and joints, boxes for furniture, a centre line down a figure.",
  "Mass is built with quick scribbled coils and a few dashes of hatching, not with shading. Much of it is unfinished and trails off into bare paper.",
  "Human, awkward and unpolished: plain observed proportions, faces barely indicated. The impossible thing in the dream is drawn as plainly as everything else.",
  "Not a cartoon, not an illustration, not cute, not tidy.",
  "Black pencil line only: no grey wash, no smudging, no tone, no colour, no text, no border, no signature. One drawing of a whole scene on a landscape sheet: a place with figures in it and something happening, never a single object on its own, with a margin of bare paper on every side.",
].join(" ");

/** A short description of the house style for the planner, so that it composes for it. */
export const HOUSE_STYLE_BRIEF =
  "a fast, rough pencil gesture drawing done from memory: searching overlapping lines, construction circles and boxes left in, scribbled mass, plain observed proportions, faces barely indicated, much of it unfinished and trailing off into bare paper. Never cartoonish, cute or tidy";

/** Extra direction for the tracing styles that read tone rather than line. */
const TONAL: Record<Exclude<Style, "line">, string> = {
  hatch: "Exception to the above: fill the main forms with flat areas of pale grey and deep black, with crisp edges between tones.",
  tsp: "Exception to the above: shade the main forms softly in graphite, with a full range from white to black.",
  spiral: "Exception to the above: render the main forms in smooth greyscale gradients with strong contrast.",
};

/** The full image prompt: the planner's description of the picture, then the house style. */
export function imagePromptFor(picture: string, style: Style): string {
  return style === "line" ? `${picture.trim()}\n\n${HOUSE_STYLE}` : `${picture.trim()}\n\n${HOUSE_STYLE} ${TONAL[style]}`;
}

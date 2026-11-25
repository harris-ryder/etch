import type { Style } from "../types";

/**
 * The house style: how every etch drawing looks, whatever the dream.
 *
 * This is the one place to change it. The planner is told about it so that it
 * composes for it, and it is appended to every image prompt.
 *
 * It has two jobs. One is taste: abstract rather than illustrative, with a
 * hand of its own. The other is practical: the tracer follows the centre of
 * each stroke, so it needs clean black line on white, with no fills or greys.
 */
export const HOUSE_STYLE = [
  "Drawn in a single distinctive hand: an abstract continuous-line drawing, as if the whole picture were bent from one long piece of black wire that never breaks.",
  "Everything is reduced to its barest gesture. Figures, animals and buildings are simplified into bold, slightly wrong, elongated shapes; faces are a single loop or left empty; nothing is rendered realistically.",
  "The line wanders, loops and doubles back on itself, passing straight through one form and on into the next, so that separate things are stitched together by the same thread.",
  "Volume and weight are suggested only by echo lines: a contour repeated in loose parallel rings, like the lines on a map or the grain in wood. Never shading.",
  "Proportion and perspective are dreamlike and off-balance: scale shifts, horizons tilt, large areas of the paper are left empty.",
  "One even, medium-weight black line on plain white paper. No solid fills, no grey, no hatching blocks, no colour, no texture, no text, no border, no frame, no signature.",
  "The picture reaches towards all four edges of a landscape sheet, composed as one finished drawing.",
].join(" ");

/** A short description of the house style for the planner, so that it composes for it. */
export const HOUSE_STYLE_BRIEF =
  "an abstract continuous-line drawing, like a sculpture bent from one unbroken wire: forms reduced to bare gestures, slightly wrong and elongated, stitched together by a line that wanders through all of them, with volume shown by repeated echo contours rather than shading, and a lot of empty paper";

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

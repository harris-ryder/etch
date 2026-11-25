/**
 * Stage 1: input.
 *
 * The pipeline only ever sees text. Anything that can produce text (typing
 * today, speech later) implements `DreamInput`.
 */
export interface DreamInput {
  toText(): Promise<string>;
}

export function textInput(text: string): DreamInput {
  return { toText: async () => text.trim() };
}

/** Speech-to-text provider. Implement with the Whisper API, or whisper.cpp on a Raspberry Pi. */
export interface SpeechToText {
  transcribe(audio: Uint8Array, mimeType: string): Promise<string>;
}

/** Wraps recorded audio as a `DreamInput` once a `SpeechToText` exists. */
export function speechInput(audio: Uint8Array, mimeType: string, stt: SpeechToText): DreamInput {
  return { toText: () => stt.transcribe(audio, mimeType) };
}

/** Placeholder so the wiring is visible. Replace with a real implementation. */
export class WhisperSpeechToText implements SpeechToText {
  async transcribe(): Promise<string> {
    throw new Error("Speech input is not implemented yet. Plug Whisper in here (see README).");
  }
}

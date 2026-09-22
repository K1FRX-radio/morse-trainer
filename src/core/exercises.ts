// Exercise kinds shared by the Learn lesson plan. Sending ("send-character") is
// retained for the future dedicated TX milestone and the standalone Practice
// screen; the RX-only Learn lesson plan does not emit it.

export type LearnExerciseType =
  | "introduce"
  | "copy-character"
  | "send-character"
  | "copy-group"
  | "copy-word";

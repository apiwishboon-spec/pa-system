// Ambient declarations. This file must stay free of top-level imports so the
// module augmentation applies globally.

declare module '*.css' {
  const css: string
  export default css
}

interface AudioContext {
  /** Id of the sink this context renders to; '' means the system default. */
  readonly sinkId: string
  setSinkId?(sinkId: string): Promise<void>
}

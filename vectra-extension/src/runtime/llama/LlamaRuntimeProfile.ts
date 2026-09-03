// Beginner guide: Handles l la ma ru nt im ep ro fi le responsibilities for Vectra.
/** Compatibility entry point; the runtime policy is shared by extension and web. */
export {
  buildLlamaRuntimeProfile,
  parseLlamaServerFlags
} from '../../core';
export type {
  LlamaRuntimeMode,
  LlamaRuntimeProfile,
  LlamaRuntimeProfileInput
} from '../../core';

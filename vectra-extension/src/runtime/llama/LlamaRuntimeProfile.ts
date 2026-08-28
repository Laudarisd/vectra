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

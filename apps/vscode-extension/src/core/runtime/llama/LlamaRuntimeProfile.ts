// Builds hardware-aware llama.cpp launch arguments.
/** Compatibility entry point; the runtime policy is shared by extension and web. */
export {
  buildLlamaRuntimeProfile,
  parseLlamaServerFlags
} from '../../models/runtimeProfile';
export type {
  LlamaRuntimeMode,
  LlamaRuntimeProfile,
  LlamaRuntimeProfileInput
} from '../../models/runtimeProfile';

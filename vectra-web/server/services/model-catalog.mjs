/**
 * A small, hand-picked "known good" list — same source data as the VS Code
 * extension's ModelCatalog.ts, kept in sync by hand since this is a separate
 * product. Re-verify before relying on these long-term: models get
 * re-quantized/renamed over time on Hugging Face.
 */
export const CURATED_MODELS = [
  {
    id: 'llama-3.2-1b-instruct-q4_k_m',
    label: 'Llama 3.2 1B Instruct (Q4_K_M)',
    family: 'llama',
    paramCount: 1,
    quant: 'Q4_K_M',
    kind: 'llm',
    sizeBytes: 807_694_464,
    minVramMiB: 1024,
    minRamMiB: 1536,
    downloadUrl: 'https://huggingface.co/bartowski/Llama-3.2-1B-Instruct-GGUF/resolve/main/Llama-3.2-1B-Instruct-Q4_K_M.gguf',
    filename: 'Llama-3.2-1B-Instruct-Q4_K_M.gguf'
  },
  {
    id: 'llama-3.2-3b-instruct-q4_k_m',
    label: 'Llama 3.2 3B Instruct (Q4_K_M)',
    family: 'llama',
    paramCount: 3,
    quant: 'Q4_K_M',
    kind: 'llm',
    sizeBytes: 2_019_377_696,
    minVramMiB: 2560,
    minRamMiB: 3584,
    downloadUrl: 'https://huggingface.co/bartowski/Llama-3.2-3B-Instruct-GGUF/resolve/main/Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    filename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf'
  },
  {
    id: 'qwen2.5-3b-instruct-q4_k_m',
    label: 'Qwen 2.5 3B Instruct (Q4_K_M)',
    family: 'qwen',
    paramCount: 3,
    quant: 'Q4_K_M',
    kind: 'llm',
    sizeBytes: 1_929_903_264,
    minVramMiB: 2560,
    minRamMiB: 3584,
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-3B-Instruct-GGUF/resolve/main/Qwen2.5-3B-Instruct-Q4_K_M.gguf',
    filename: 'Qwen2.5-3B-Instruct-Q4_K_M.gguf'
  },
  {
    id: 'phi-3.5-mini-instruct-q4_k_m',
    label: 'Phi 3.5 Mini Instruct (Q4_K_M)',
    family: 'phi',
    paramCount: 3.8,
    quant: 'Q4_K_M',
    kind: 'llm',
    sizeBytes: 2_393_232_672,
    minVramMiB: 3072,
    minRamMiB: 4096,
    downloadUrl: 'https://huggingface.co/bartowski/Phi-3.5-mini-instruct-GGUF/resolve/main/Phi-3.5-mini-instruct-Q4_K_M.gguf',
    filename: 'Phi-3.5-mini-instruct-Q4_K_M.gguf'
  },
  {
    id: 'mistral-7b-instruct-v0.3-q4_k_m',
    label: 'Mistral 7B Instruct v0.3 (Q4_K_M)',
    family: 'mistral',
    paramCount: 7,
    quant: 'Q4_K_M',
    kind: 'llm',
    sizeBytes: 4_372_812_000,
    minVramMiB: 5120,
    minRamMiB: 6656,
    downloadUrl: 'https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
    filename: 'Mistral-7B-Instruct-v0.3-Q4_K_M.gguf'
  },
  {
    id: 'qwen2.5-7b-instruct-q4_k_m',
    label: 'Qwen 2.5 7B Instruct (Q4_K_M)',
    family: 'qwen',
    paramCount: 7,
    quant: 'Q4_K_M',
    kind: 'llm',
    sizeBytes: 4_683_074_240,
    minVramMiB: 5632,
    minRamMiB: 7168,
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-7B-Instruct-GGUF/resolve/main/Qwen2.5-7B-Instruct-Q4_K_M.gguf',
    filename: 'Qwen2.5-7B-Instruct-Q4_K_M.gguf'
  },
  {
    id: 'llama-3.1-8b-instruct-q4_k_m',
    label: 'Llama 3.1 8B Instruct (Q4_K_M)',
    family: 'llama',
    paramCount: 8,
    quant: 'Q4_K_M',
    kind: 'llm',
    sizeBytes: 4_920_739_232,
    minVramMiB: 5888,
    minRamMiB: 7168,
    downloadUrl: 'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
    filename: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf'
  },
  {
    id: 'gemma-2-9b-it-q4_k_m',
    label: 'Gemma 2 9B Instruct (Q4_K_M)',
    family: 'gemma',
    paramCount: 9,
    quant: 'Q4_K_M',
    kind: 'llm',
    sizeBytes: 5_761_057_728,
    minVramMiB: 6656,
    minRamMiB: 8192,
    downloadUrl: 'https://huggingface.co/bartowski/gemma-2-9b-it-GGUF/resolve/main/gemma-2-9b-it-Q4_K_M.gguf',
    filename: 'gemma-2-9b-it-Q4_K_M.gguf'
  },
  {
    id: 'qwen2.5-14b-instruct-q4_k_m',
    label: 'Qwen 2.5 14B Instruct (Q4_K_M)',
    family: 'qwen',
    paramCount: 14,
    quant: 'Q4_K_M',
    kind: 'llm',
    sizeBytes: 8_988_110_976,
    minVramMiB: 10240,
    minRamMiB: 12288,
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-14B-Instruct-GGUF/resolve/main/Qwen2.5-14B-Instruct-Q4_K_M.gguf',
    filename: 'Qwen2.5-14B-Instruct-Q4_K_M.gguf'
  },
  {
    id: 'qwen2.5-32b-instruct-q4_k_m',
    label: 'Qwen 2.5 32B Instruct (Q4_K_M)',
    family: 'qwen',
    paramCount: 32,
    quant: 'Q4_K_M',
    kind: 'llm',
    sizeBytes: 19_851_336_576,
    minVramMiB: 21504,
    minRamMiB: 24576,
    downloadUrl: 'https://huggingface.co/bartowski/Qwen2.5-32B-Instruct-GGUF/resolve/main/Qwen2.5-32B-Instruct-Q4_K_M.gguf',
    filename: 'Qwen2.5-32B-Instruct-Q4_K_M.gguf'
  },
  {
    id: 'qwen2.5-vl-3b-instruct-q4_k_m',
    label: 'Qwen 2.5 VL 3B Instruct (Q4_K_M, vision)',
    family: 'qwen',
    paramCount: 3,
    quant: 'Q4_K_M',
    kind: 'vlm',
    sizeBytes: 1_929_902_656 + 1_338_428_640,
    minVramMiB: 4096,
    minRamMiB: 5632,
    downloadUrl: 'https://huggingface.co/Mungert/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-q4_k_m.gguf',
    filename: 'Qwen2.5-VL-3B-Instruct-Q4_K_M.gguf',
    mmprojUrl: 'https://huggingface.co/Mungert/Qwen2.5-VL-3B-Instruct-GGUF/resolve/main/Qwen2.5-VL-3B-Instruct-mmproj-f16.gguf',
    mmprojFilename: 'mmproj-Qwen2.5-VL-3B-Instruct-f16.gguf'
  },
  {
    id: 'qwen3-vl-8b-instruct-q4_k_m',
    label: 'Qwen 3 VL 8B Instruct (Q4_K_M, vision)',
    family: 'qwen',
    paramCount: 8,
    quant: 'Q4_K_M',
    kind: 'vlm',
    sizeBytes: 5_027_784_800 + 752_289_728,
    minVramMiB: 6656,
    minRamMiB: 8192,
    downloadUrl: 'https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF/resolve/main/Qwen3VL-8B-Instruct-Q4_K_M.gguf',
    filename: 'Qwen3VL-8B-Instruct-Q4_K_M.gguf',
    mmprojUrl: 'https://huggingface.co/Qwen/Qwen3-VL-8B-Instruct-GGUF/resolve/main/mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf',
    mmprojFilename: 'mmproj-Qwen3VL-8B-Instruct-Q8_0.gguf'
  }
];

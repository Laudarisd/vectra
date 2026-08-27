export type LlamaRuntimeMode = 'gpu-resident' | 'hybrid' | 'cpu';
export interface RuntimeHardwareSnapshot {
    gpus: Array<{
        name?: string;
        vramMiB?: number;
    }>;
    maxVramMiB?: number;
    cpuCores: number;
    totalRamMiB: number;
    platform: string;
}
export interface LlamaRuntimeProfileInput {
    hardware: RuntimeHardwareSnapshot;
    modelBytes: number;
    requestedContextSize: number;
    deviceMode: 'auto' | 'gpu' | 'cpu';
    gpuLayers: string;
    splitMode: string;
    cpuMoe: boolean;
    noMmap: boolean;
    supportedFlags: ReadonlySet<string>;
}
export interface LlamaRuntimeProfile {
    mode: LlamaRuntimeMode;
    contextSize: number;
    args: string[];
    summary: string;
}
/** Shared adaptive policy used by the VS Code and Node.js llama.cpp hosts. */
export declare function buildLlamaRuntimeProfile(input: LlamaRuntimeProfileInput): LlamaRuntimeProfile;
export declare function parseLlamaServerFlags(help: string): Set<string>;
//# sourceMappingURL=runtimeProfile.d.ts.map
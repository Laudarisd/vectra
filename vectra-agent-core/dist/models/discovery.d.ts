export interface DiscoveredGgufModel {
    kind: 'gguf';
    id: string;
    label: string;
    detail: string;
    size: number;
}
export interface DiscoveredOllamaModel {
    kind: 'ollama';
    id: string;
    label: string;
    detail: string;
    size?: number;
}
export interface DiscoveredRuntimeModel {
    kind: 'runtime';
    id: string;
    label: string;
    detail: string;
    baseUrl: string;
}
export type DiscoveredLocalModel = DiscoveredGgufModel | DiscoveredOllamaModel | DiscoveredRuntimeModel;
export interface LocalRuntimeTarget {
    name: string;
    baseUrl: string;
    discoveryUrl?: string;
    format?: 'ollama' | 'openai';
    apiKey?: string;
}
export interface DiscoveredRuntime {
    name: string;
    baseUrl: string;
    models: string[];
}
export interface InstalledModelInventory {
    gguf: DiscoveredGgufModel[];
    ollama: DiscoveredOllamaModel[];
    runtimes: DiscoveredRuntime[];
    runtimeModels: DiscoveredRuntimeModel[];
}
export declare const LOCAL_RUNTIME_TARGETS: readonly LocalRuntimeTarget[];
export declare function discoverGgufModels(extraRoots?: string[], maxDirectories?: number, maxModels?: number): Promise<DiscoveredGgufModel[]>;
export declare function searchGgufModels(options?: {
    query?: string;
    roots?: string[];
    limit?: number;
    maxDirectories?: number;
}): Promise<string[]>;
/** Finds Ollama models even when its server is stopped: API, CLI, and manifest index are merged. */
export declare function discoverOllamaModels(baseUrl?: string): Promise<DiscoveredOllamaModel[]>;
export declare function discoverLocalRuntimes(extra?: LocalRuntimeTarget[]): Promise<DiscoveredRuntime[]>;
export declare function discoverOpenAICompatibleModels(extra?: LocalRuntimeTarget[]): Promise<DiscoveredRuntimeModel[]>;
/** One shared detection pass for both Vectra hosts. This includes offline GGUF
 * files, Ollama's API/CLI/on-disk manifests, and running local API servers. */
export declare function discoverInstalledModels(options?: {
    extraRoots?: string[];
    ollamaBaseUrl?: string;
    runtimeTargets?: LocalRuntimeTarget[];
    maxDirectories?: number;
    maxModels?: number;
}): Promise<InstalledModelInventory>;
export declare function appModelDirectories(): string[];
export declare function broadModelDirectories(): string[];
export declare function commonModelDirectories(): string[];
export declare function defaultModelRoots(): string[];
export declare function normalizeShardPath(filePath: string): string;
export declare function formatBytes(bytes: number): string;
//# sourceMappingURL=discovery.d.ts.map
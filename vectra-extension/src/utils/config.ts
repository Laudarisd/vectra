import * as vscode from 'vscode';
import * as path from 'node:path';
import { ProviderId } from '../types';

const SECTION = 'vectra';

export type DeviceMode = 'auto' | 'gpu' | 'cpu';
export type ThemeMode = 'auto' | 'grayWhite';
export type AgentHarness = 'deepagents' | 'vectra';

export interface AgentConfiguration {
  provider: ProviderId;
  model: string;
  agentHarness: AgentHarness;
  localModelPath: string;
  localModelDirectory: string;
  modelsDirectory: string;
  llamaCppServerPath: string;
  llamaCppPort: number;
  llamaCppContextSize: number;
  llamaCppLoadTimeoutSeconds: number;
  llamaCppGpuLayers: string;
  llamaCppThreads: number;
  llamaCppThreadProfile: 'auto' | 'performance' | 'efficiency';
  llamaCppSplitMode: 'none' | 'layer' | 'row' | 'tensor';
  llamaCppCpuMoe: boolean;
  llamaCppNoMmap: boolean;
  llamaCppMmprojPath: string;
  llamaCppExtraArgs: string[];
  deviceMode: DeviceMode;
  theme: ThemeMode;
  ollamaBaseUrl: string;
  ollamaContextSize: number;
  openaiCompatibleBaseUrl: string;
  openaiBaseUrl: string;
  anthropicBaseUrl: string;
  geminiBaseUrl: string;
  maxAgentSteps: number;
  maxSubagentSteps: number;
  maxConcurrentSubagents: number;
  maxFileBytes: number;
  maxContextCharacters: number;
  localRequestTimeoutSeconds: number;
  excludeGlob: string;
  supportDeveloperUrl: string;
  showDiagnosticsInContext: boolean;
  allowSensitiveFiles: boolean;
}

export function getConfig(): AgentConfiguration {
  const c = vscode.workspace.getConfiguration(SECTION);
  return {
    provider: c.get<ProviderId>('provider', 'llamaCpp'),
    model: c.get<string>('model', '').trim(),
    agentHarness: c.get<AgentHarness>('agentHarness', 'deepagents'),
    localModelPath: c.get<string>('localModelPath', '').trim(),
    localModelDirectory: c.get<string>('localModelDirectory', '').trim(),
    modelsDirectory: c.get<string>('modelsDirectory', '').trim(),
    llamaCppServerPath: c.get<string>('llamaCppServerPath', '').trim(),
    llamaCppPort: c.get<number>('llamaCppPort', 8080),
    llamaCppContextSize: c.get<number>('llamaCppContextSize', 16384),
    llamaCppLoadTimeoutSeconds: c.get<number>('llamaCppLoadTimeoutSeconds', 3600),
    llamaCppGpuLayers: c.get<string>('llamaCppGpuLayers', 'auto').trim() || 'auto',
    llamaCppThreads: c.get<number>('llamaCppThreads', 0),
    llamaCppThreadProfile: c.get<AgentConfiguration['llamaCppThreadProfile']>('llamaCppThreadProfile', 'auto'),
    llamaCppSplitMode: c.get<AgentConfiguration['llamaCppSplitMode']>('llamaCppSplitMode', 'layer'),
    llamaCppCpuMoe: c.get<boolean>('llamaCppCpuMoe', false),
    llamaCppNoMmap: c.get<boolean>('llamaCppNoMmap', false),
    llamaCppMmprojPath: c.get<string>('llamaCppMmprojPath', '').trim(),
    llamaCppExtraArgs: c.get<string[]>('llamaCppExtraArgs', []),
    deviceMode: c.get<DeviceMode>('deviceMode', 'auto'),
    theme: c.get<ThemeMode>('theme', 'auto'),
    ollamaBaseUrl: trim(c.get<string>('ollamaBaseUrl', 'http://localhost:11434')),
    ollamaContextSize: c.get<number>('ollamaContextSize', 8192),
    openaiCompatibleBaseUrl: trim(c.get<string>('openaiCompatibleBaseUrl', 'http://localhost:1234/v1')),
    openaiBaseUrl: trim(c.get<string>('openaiBaseUrl', 'https://api.openai.com/v1')),
    anthropicBaseUrl: trim(c.get<string>('anthropicBaseUrl', 'https://api.anthropic.com/v1')),
    geminiBaseUrl: trim(c.get<string>('geminiBaseUrl', 'https://generativelanguage.googleapis.com/v1beta')),
    maxAgentSteps: c.get<number>('maxAgentSteps', 12),
    maxSubagentSteps: c.get<number>('maxSubagentSteps', 6),
    maxConcurrentSubagents: c.get<number>('maxConcurrentSubagents', 2),
    maxFileBytes: c.get<number>('maxFileBytes', 1_000_000),
    maxContextCharacters: c.get<number>('maxContextCharacters', 180_000),
    localRequestTimeoutSeconds: c.get<number>('localRequestTimeoutSeconds', 3600),
    excludeGlob: c.get<string>('excludeGlob', '**/{node_modules,.git,dist,build,out,.next,.venv,venv,__pycache__,coverage}/**'),
    supportDeveloperUrl: c.get<string>('supportDeveloperUrl', 'https://github.com/Laudarisd/vectra'),
    showDiagnosticsInContext: c.get<boolean>('showDiagnosticsInContext', true),
    allowSensitiveFiles: c.get<boolean>('allowSensitiveFiles', false)
  };
}

export async function updateProvider(value: ProviderId): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update('provider', value, vscode.ConfigurationTarget.Global);
}
export async function updateDeviceMode(value: DeviceMode): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update('deviceMode', value, vscode.ConfigurationTarget.Global);
}
export async function updateTheme(value: ThemeMode): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update('theme', value, vscode.ConfigurationTarget.Global);
}
export async function updateModel(value: string): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update('model', value, vscode.ConfigurationTarget.Global);
}
/**
 * Selecting a model must not silently narrow the folder Vectra scans. Picking
 * D:\models\org\repo\x.gguf while D:\models is the saved scan root would otherwise
 * leave detection looking at one leaf directory forever, so an existing root that
 * still contains the model is kept as-is.
 */
export async function updateLocalModel(value: string): Promise<void> {
  const config = vscode.workspace.getConfiguration(SECTION);
  await config.update('localModelPath', value, vscode.ConfigurationTarget.Global);
  const saved = config.get<string>('localModelDirectory', '').trim();
  if (!saved || !containsPath(saved, value)) {
    await config.update('localModelDirectory', path.dirname(value), vscode.ConfigurationTarget.Global);
  }
}

/** True when `directory` is `filePath`'s own folder or one of its ancestors. */
function containsPath(directory: string, filePath: string): boolean {
  const relative = path.relative(path.resolve(directory), path.resolve(path.dirname(filePath)));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
export async function updateLocalModelDirectory(value: string): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update('localModelDirectory', value, vscode.ConfigurationTarget.Global);
}
export async function updateModelsDirectory(value: string): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update('modelsDirectory', value, vscode.ConfigurationTarget.Global);
}
export async function updateOpenAICompatibleBaseUrl(value: string): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update('openaiCompatibleBaseUrl', value, vscode.ConfigurationTarget.Global);
}
export async function updateLlamaServerPath(value: string): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update('llamaCppServerPath', value, vscode.ConfigurationTarget.Global);
}
export async function updateLlamaMmprojPath(value: string): Promise<void> {
  await vscode.workspace.getConfiguration(SECTION).update('llamaCppMmprojPath', value, vscode.ConfigurationTarget.Global);
}

function trim(value: string): string { return value.replace(/\/+$/, ''); }

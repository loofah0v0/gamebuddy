/** Shared contract: game adapters supply capabilities, not an agent loop. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface GameRuntime {
  signal: AbortSignal;
  preview?: (url: string) => Promise<void>;
  event: (kind: string, data: Json) => void;
  /** Persist before ACKing external event delivery. */
  deliver?: (kind: string, data: Json) => Promise<void>;
}
export interface GamePlugin {
  id: string;
  title: string;
  defaults: Json;
  parseConfig: (input: unknown) => Json;
  /** Public serialized schemas and policy belong to the installed game package. */
  configSchema: Json;
  planSchema: Json;
  validatePlan: (config: Json, plan: Json) => Json;
  capabilities: { schedule: boolean };
  setup?: (config: Json, context: { root: string; signal: AbortSignal; configured: boolean }) => Promise<Json>;
  /** Optional pure intent compiler: proposals only, no persistence or device I/O. */
  requestSchema?: Json;
  prepare?: (config: Json, request: Json) => Json;
  questions: (config: Json) => string[];
  diagnose: (config: Json, signal?: AbortSignal) => Promise<Json>;
  execute: (config: Json, plan: Json, runtime: GameRuntime) => Promise<Json>;
  screenshot?: (config: Json, signal: AbortSignal) => Promise<Buffer>;
  control?: (config: Json, action: Json, signal: AbortSignal) => Promise<Json>;
  /** Stable extra ownership keys (e.g. emulator install + instance), in addition to ADB. */
  deviceKeys?: (config: Json) => string[];
  deviceLaunch?: (config: Json) => { executable: string; instanceIndex: number } | undefined;
  startDevice?: (config: Json, signal: AbortSignal, progress: (message: string) => void) => Promise<{ config: Json; detail: Json }>;
  dispose?: () => Promise<void>;
}
export interface RunRecord {
  id: string; game: string; instance: string; occurrence?: string;
  startedAt: string; endedAt?: string;
  status: 'running' | 'completed' | 'failed' | 'stopped' | 'interrupted';
  events: { at: string; kind: string; data: Json }[];
  result?: Json; error?: string;
}
export const catalog = [
 {id:'arknights',title:'明日方舟 · MAA',package:'@gameguy/arknights',folder:'plugin-arknights',kind:'native-library'},
 {id:'minecraft',title:'Minecraft · Mineflayer',package:'@gameguy/minecraft',folder:'plugin-minecraft',kind:'protocol'},
] as const;

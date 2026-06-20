// Type definitions for @promptwise-dev/core
// Project: https://github.com/Nirupam014/promptwise

export type Surface = "browser" | "ide" | "cli" | "desktop" | "unknown";

export type Persona =
  | "developer"
  | "power-chatter"
  | "analyst-writer"
  | "team-lead"
  | "generic";

export interface ConversationMessage {
  role?: "user" | "assistant" | "system" | string;
  content: string;
}

export interface MemoryFact {
  id: string;
  text: string;
  type: string;
  pinned: boolean;
  createdAt: string;
}

export interface RewriteChange {
  type:
    | "remove-filler"
    | "remove-hedge"
    | "simplify-verbose"
    | "drop-known-context"
    | "drop-internal-repeat"
    | string;
  occurrences?: number;
  reason?: string;
  examples?: string[];
}

export interface RewriteResult {
  original: string;
  rewritten: string;
  originalTokens: number;
  rewrittenTokens: number;
  tokensSaved: number;
  percentSaved: number;
  changes: RewriteChange[];
  /** true when the rewrite actually saved tokens */
  applied: boolean;
  constraintsPreserved: boolean;
  protectedSpans?: number;
}

export interface RewriteOptions {
  /** visible conversation context (strings or {role, content}) */
  context?: (string | ConversationMessage)[];
  /** relevant memory facts (strings or {text}) */
  memory?: (string | { text: string })[];
  persona?: PersonaResult;
  /** similarity at/above which a prompt sentence already in context is dropped (default 0.82) */
  contextDropThreshold?: number;
  /** similarity at/above which an internally-repeated sentence is dropped (default 0.85) */
  repeatThreshold?: number;
}

/** Output-token control: append a brevity directive to the suggested prompt. */
export type OutputBudget =
  | boolean
  | { words?: number; noPreamble?: boolean; style?: "bullets" | "prose" };

export interface PersonaSignals {
  surface?: Surface;
  hostApp?: string;
  fileTypes?: string[];
  promptText?: string;
  threadLength?: number;
  /** selected chat model id — enables the model-fit (cost) check */
  model?: string;
}

export interface ModelFit {
  known: boolean;
  model: string;
  family: string;
  tier: 0 | 1 | 2 | 3;
  complexity: number;
  complexityLabel: "simple" | "moderate" | "complex";
  overkill: boolean;
  suggestion: string | null;
  message: string | null;
}

export interface PersonaResult {
  persona: Persona;
  confidence: number;
  reasons: string[];
  tailoring: { style: string; note: string };
  task: "writing" | "coding" | "general";
}

export interface FloodOptions {
  goal?: string;
  softTokenBudget?: number;
  hardTokenBudget?: number;
  softTurns?: number;
  hardTurns?: number;
  redundancyThreshold?: number;
  driftThreshold?: number;
}

export interface FloodResult {
  recommendation: "none" | "summarize" | "reset";
  severity: number;
  reasons: string[];
  signals: {
    totalTokens: number;
    turnCount: number;
    redundancy: number;
    drift: number;
  };
  message: string | null;
  carryToMemory: string[];
}

export interface Suggestion {
  headline: string;
  /** the prompt to send (compressed; includes the brevity directive if enabled) */
  rewritten: string;
  reasons: string[];
  /** the appended output-brevity directive, or null when disabled */
  outputDirective?: string | null;
}

export interface OptimizeInput {
  prompt: string;
  context?: (string | ConversationMessage)[];
  signals?: PersonaSignals;
}

export interface OptimizeResult {
  persona: PersonaResult;
  rewrite: RewriteResult;
  usedMemory: string[];
  suggestion: Suggestion | null;
  /** present when signals.model was provided */
  modelFit: ModelFit | null;
}

export class Memory {
  constructor(initial?: (string | Partial<MemoryFact>)[]);
  facts: MemoryFact[];
  add(text: string, opts?: { type?: string; pinned?: boolean }): MemoryFact | null;
  remove(id: string): boolean;
  list(): MemoryFact[];
  findRelevant(prompt: string, threshold?: number): MemoryFact[];
  toJSON(): MemoryFact[];
}

export interface PromptWiseConfig {
  memory?: Memory | (string | Partial<MemoryFact>)[];
  provider?: LLMProvider | null;
  outputBudget?: OutputBudget;
  contextDropThreshold?: number;
  repeatThreshold?: number;
}

export interface LLMProvider {
  info(): { backend: string; model?: string };
  available(): Promise<boolean>;
  complete(req: { system?: string; prompt: string; json?: boolean }): Promise<string>;
}

export interface LLMOptimizeResult extends OptimizeResult {
  mode: "llm" | "heuristic";
  llm: { used: boolean; rejected?: boolean; reason?: string; error?: string };
}

export class PromptWise {
  constructor(config?: PromptWiseConfig);
  memory: Memory;
  stats: { promptsOptimized: number; tokensSaved: number };
  provider: LLMProvider | null;
  outputBudget: OutputBudget | null;
  optimize(input: OptimizeInput): OptimizeResult;
  assessModel(model: string, prompt: string): ModelFit;
  analyzeConversation(messages: ConversationMessage[], opts?: FloodOptions): FloodResult;
  countTokens(text: string): number;
  setProvider(provider: LLMProvider | null): this;
  setOutputBudget(budget: OutputBudget | null): this;
  optimizeWithLLM(input: OptimizeInput): Promise<LLMOptimizeResult>;
  summarizeThread(messages: ConversationMessage[]): Promise<{ summary: string | null; facts: string[]; mode: "llm" | "heuristic" }>;
  curateMemory(candidates: (string | { text: string })[]): Promise<{ facts: string[]; removed?: string[]; mode: "llm" | "heuristic" }>;
}

export function createOllamaProvider(opts?: {
  endpoint?: string; model?: string; temperature?: number; fetchImpl?: typeof fetch;
}): LLMProvider & { hasModel(): Promise<boolean> };

export function createWebLLMProvider(opts: { engine: any; model?: string; temperature?: number }): LLMProvider;

export function verifyRewrite(original: string, candidate: string): { ok: boolean; reason: string };

export function rewrite(prompt: string, opts?: RewriteOptions): RewriteResult;
export function analyzeFlood(messages: ConversationMessage[], opts?: FloodOptions): FloodResult;
export function detectPersona(signals: PersonaSignals): PersonaResult;
export function estimateTokens(text: string): number;
export function assessModel(model: string, prompt: string): ModelFit;

export const version: string;

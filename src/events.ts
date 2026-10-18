import { EventEmitter } from "node:events";
import type { GodName } from "./config.js";

export interface TestResult {
  passed: number;
  failed: number;
  failing: string[];
  /** False when no runner summary was recognised and counts came from the exit code. */
  parsed: boolean;
}

export interface Boss {
  name: string;
  hp: number;
  maxHp: number;
  startHp: number;
}

export interface Labour {
  id: string;
  title: string;
  description: string;
  reward: number;
}

/** Every event the harness emits. The agent emits the first group; the game emits the rest. */
export interface EventMap {
  turn_start: { god: GodName };
  text: { god: GodName; delta: string };
  thinking: { god: GodName; delta: string };
  tool_start: { god: GodName; id: string; name: string; summary: string };
  tool_end: { god: GodName; id: string; name: string; ok: boolean; summary: string };
  approval: { god: GodName; tool: string; summary: string; approved: boolean; risky: boolean };
  edit: { god: GodName; path: string };
  shell_result: { god: GodName; command: string; exitCode: number | null; risky: boolean; approved: boolean };
  test_result: TestResult;
  review: { approved: boolean };
  turn_end: { god: GodName; text: string; stopReason: string | null; inputTokens: number; outputTokens: number };
  error: { message: string };
  notice: { text: string };

  xp: { amount: number; reason: string; total: number };
  rank_up: { rank: string };
  labour: Labour;
  boss: { boss: Boss | null; change: "spawn" | "hit" | "grow" | "defeated" | "none" };
  narration: { text: string };
}

export type EventName = keyof EventMap;

export class Bus {
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  emit<K extends EventName>(name: K, payload: EventMap[K]): void {
    this.emitter.emit(name, payload);
  }

  on<K extends EventName>(name: K, listener: (payload: EventMap[K]) => void): () => void {
    this.emitter.on(name, listener);
    return () => this.emitter.off(name, listener);
  }
}

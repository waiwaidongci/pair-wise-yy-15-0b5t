// 界面状态：唯一一份 AppState，useSyncExternalStore 订阅；派生数据全部在规则层计算。
import { useSyncExternalStore } from "react";
import type { AppState, SubmissionResult } from "../types";
import { apply, loadState, saveState, type Action } from "../store";

let state: AppState = loadState();
const listeners = new Set<() => void>();
let lastResult: SubmissionResult | null = null;
let resultSeq = 0;

function emit() {
  listeners.forEach((l) => l());
}

export function dispatch(action: Action): SubmissionResult {
  const out = apply(state, action);
  if (out.state !== state) {
    state = out.state;
    saveState(state);
    emit();
  }
  lastResult = out.result;
  resultSeq += 1;
  resultListeners.forEach((l) => l(lastResult!, resultSeq));
  return out.result;
}

const resultListeners = new Set<(r: SubmissionResult, seq: number) => void>();

export function subscribeResult(fn: (r: SubmissionResult, seq: number) => void): () => void {
  resultListeners.add(fn);
  return () => resultListeners.delete(fn);
}

export function getLastResult() {
  return { result: lastResult, seq: resultSeq };
}

export function useAppState(): AppState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}

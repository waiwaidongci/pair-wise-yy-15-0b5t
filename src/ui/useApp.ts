// React 绑定：所有界面从 useApp() 获取同一份状态与同一套推导视图，
// 列表、统计刷新后一致；操作结果通过统一 toast 反馈。
import { useSyncExternalStore } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { actions, store, type IdemOutcome } from "../data/store";
import { deriveView, type DerivedView } from "../domain/rules";
import type { AppState } from "../domain/types";

export interface Toast {
  id: number;
  kind: "success" | "error" | "info";
  text: string;
}

let toastSeq = 0;

export function useApp() {
  const state = useSyncExternalStore(
    store.subscribe,
    store.getState,
    store.getState
  );
  // 20 秒心跳，让冻结倒计时/“×小时前”随时间刷新；状态变更也会立即重算
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 20_000);
    return () => clearInterval(t);
  }, []);

  const now = Date.now();
  const view: DerivedView = useMemo(
    () => deriveView(state, Date.now()),
    [state, Math.floor(now / 20_000)]
  );

  const [toasts, setToasts] = useState<Toast[]>([]);
  const pushToast = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++toastSeq;
    setToasts((list) => [...list, { id, kind, text }]);
    setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id));
    }, 4200);
  }, []);

  const run = useCallback(
    async (p: Promise<IdemOutcome>): Promise<IdemOutcome> => {
      const res = await p;
      if (res.status === "done")
        pushToast("success", res.duplicate ? `重复提交：${res.message}` : res.message ?? "已保存");
      else if (res.status === "busy") pushToast("info", res.message);
      else pushToast("error", res.message);
      return res;
    },
    [pushToast]
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  return {
    state: state as AppState,
    view,
    now,
    toasts,
    dismissToast,
    run,
    actions,
    resetDemo: store.resetDemo,
  };
}

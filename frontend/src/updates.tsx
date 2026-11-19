// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useState } from "react";
import "./updates.css";

type Status = {
  phase: string;
  version: string;
  notes: string;
  progress: number;
};
type Bridge = {
  Status(): Promise<Status>;
  Check(): Promise<void>;
  Download(): Promise<void>;
  Cancel(): Promise<void>;
  Install(): Promise<void>;
  FrontendReady(): Promise<boolean>;
};

const dismissedKey = "find-a-note.update.deferred";
const initial: Status = { phase: "idle", version: "", notes: "", progress: 0 };

export function useUpdates() {
  const backend = (window.go?.main as { UpdateBridge?: Bridge } | undefined)
    ?.UpdateBridge;
  const [status, setStatus] = useState(initial);
  const [manual, setManual] = useState(false);
  const [pending, setPending] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const [deferred, setDeferred] = useState(() => {
    try {
      return localStorage.getItem(dismissedKey) ?? "";
    } catch {
      return "";
    }
  });

  useEffect(() => {
    if (!backend) return;
    void backend
      .FrontendReady()
      .then(setRecovered)
      .catch(() => {});
  }, [backend]);

  useEffect(() => {
    if (
      !backend ||
      (!pending &&
        !["idle", "checking", "downloading", "installing"].includes(
          status.phase,
        ))
    )
      return;
    let active = true;
    const refresh = () =>
      void backend
        .Status()
        .then((next) => {
          if (active) setStatus(next);
        })
        .catch(() => {});
    refresh();
    const timer = window.setInterval(refresh, 500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [backend, pending, status.phase]);

  async function run(action: "Check" | "Download" | "Cancel" | "Install") {
    if (!backend) return;
    if (action === "Check") setManual(true);
    if (action !== "Cancel") setPending(true);
    try {
      await backend[action]();
      setStatus(await backend.Status());
    } catch {
      const phase =
        action === "Check"
          ? "check-error"
          : action === "Install"
            ? "install-error"
            : "download-error";
      setStatus((state) => ({ ...state, phase }));
    } finally {
      if (action !== "Cancel") setPending(false);
    }
  }

  function defer() {
    setDeferred(status.version);
    setManual(false);
    try {
      localStorage.setItem(dismissedKey, status.version);
    } catch {
      /* Retain the preference for this session. */
    }
  }

  return {
    enabled: Boolean(backend) && status.phase !== "unsupported",
    status,
    manual,
    pending,
    recovered,
    dismissRecovery: () => setRecovered(false),
    notify:
      recovered || (Boolean(status.version) && status.version !== deferred),
    showOffer: manual || status.version !== deferred,
    run,
    defer,
  };
}

export function UpdatePanel({
  update,
}: {
  update: ReturnType<typeof useUpdates>;
}) {
  const { status, pending, manual, recovered, showOffer, run } = update;
  const [confirm, setConfirm] = useState(false);
  if (!update.enabled && !recovered) return null;
  const phase = status.phase;
  const offer =
    showOffer && (phase === "available" || phase === "download-error");
  const ready = phase === "ready" || phase === "install-error";
  const check = [
    "idle",
    "current",
    "unavailable",
    "available",
    "check-error",
    "download-error",
  ].includes(phase);
  return (
    <div className="update-panel">
      {recovered && (
        <div role="status">
          Обновление не удалось. Предыдущая версия восстановлена.
          <button onClick={update.dismissRecovery}>Закрыть сообщение</button>
        </div>
      )}
      {check && (
        <button disabled={pending} onClick={() => void run("Check")}>
          Проверить обновления
        </button>
      )}
      {manual && phase === "checking" && (
        <p role="status">Проверяем обновления…</p>
      )}
      {manual && phase === "current" && (
        <p role="status">Установлена последняя версия.</p>
      )}
      {manual && phase === "unavailable" && (
        <p role="status">
          Для этого варианта приложения обновление недоступно.
        </p>
      )}
      {manual && phase === "check-error" && (
        <p role="status">Не удалось проверить обновления.</p>
      )}
      {offer && (
        <>
          <p role="status">Доступно обновление Find a Note {status.version}</p>
          {status.notes && <p className="update-notes">{status.notes}</p>}
          {phase === "download-error" && (
            <p role="status">Не удалось скачать или проверить файл.</p>
          )}
          <div className="update-actions">
            <button disabled={pending} onClick={update.defer}>
              Позже
            </button>
            <button disabled={pending} onClick={() => void run("Download")}>
              {phase === "download-error"
                ? "Повторить загрузку"
                : "Скачать обновление"}
            </button>
          </div>
        </>
      )}
      {phase === "downloading" && (
        <>
          <label>
            Загрузка обновления <progress max={100} value={status.progress} />
          </label>
          <button onClick={() => void run("Cancel")}>Отменить загрузку</button>
        </>
      )}
      {ready && (
        <>
          <p role="status">
            {phase === "install-error"
              ? "Не удалось подготовить замену. Проверьте права записи в каталог приложения."
              : "Обновление проверено и готово к установке."}
          </p>
          {confirm && (
            <p>
              Текущая тренировка завершится. Приложение откроется снова после
              обновления.
            </p>
          )}
          <div className="update-actions">
            {confirm ? (
              <>
                <button onClick={() => setConfirm(false)}>Назад</button>
                <button
                  disabled={pending}
                  onClick={() => {
                    setConfirm(false);
                    void run("Install");
                  }}
                >
                  Подтвердить перезапуск
                </button>
              </>
            ) : (
              <>
                <button disabled={pending} onClick={() => void run("Cancel")}>
                  Отменить обновление
                </button>
                <button disabled={pending} onClick={() => setConfirm(true)}>
                  Установить обновление
                </button>
              </>
            )}
          </div>
        </>
      )}
      {phase === "installing" && (
        <p role="status">Подготавливаем перезапуск…</p>
      )}
    </div>
  );
}

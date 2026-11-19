// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { info as product } from "../../wails.json";
import "./updates.css";

type Status = {
  phase: string;
  version: string;
  notes: string;
  progress: number;
  received: number;
  total: number;
  problem: string;
};
type Action = "Check" | "Download" | "Install";
type Bridge = {
  Status(): Promise<Status>;
  Check(): Promise<void>;
  Download(): Promise<void>;
  Cancel(): Promise<void>;
  Install(): Promise<void>;
  FrontendReady(): Promise<string>;
};

const initial: Status = {
  phase: "idle",
  version: "",
  notes: "",
  progress: 0,
  received: 0,
  total: 0,
  problem: "",
};
const actionPhase = {
  Check: "checking",
  Download: "downloading",
  Install: "installing",
};
const errorPhase = {
  Check: "check-error",
  Download: "download-error",
  Install: "install-error",
};

function sameStatus(a: Status, b: Status) {
  return (
    a.phase === b.phase &&
    a.version === b.version &&
    a.notes === b.notes &&
    a.progress === b.progress &&
    a.received === b.received &&
    a.total === b.total &&
    a.problem === b.problem
  );
}

export function useUpdates() {
  const backend = (window.go?.main as { UpdateBridge?: Bridge } | undefined)
    ?.UpdateBridge;
  const [status, setStatus] = useState(initial);
  const [action, setAction] = useState<Action>();
  const activeAction = useRef<Action>(undefined);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const cancelSent = useRef(false);
  const closeAfterDownload = useRef(false);
  const revision = useRef(0);

  useEffect(() => {
    let active = true;
    void backend
      ?.FrontendReady()
      .then((result) => {
        if (active) setNotice(result);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [backend]);

  useEffect(() => {
    if (!backend) return;
    let stopped = false;
    let timer: number;
    async function refresh() {
      const requested = revision.current;
      try {
        const next = await backend!.Status();
        if (!stopped && revision.current === requested) {
          setStatus((current) => (sameStatus(current, next) ? current : next));
        }
      } catch {
        // An individual missed snapshot can be retried on the next refresh.
      } finally {
        if (!stopped) timer = window.setTimeout(refresh, open ? 200 : 1000);
      }
    }
    void refresh();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [backend, open]);

  useEffect(() => {
    if (!cancelling || status.phase !== "downloading" || cancelSent.current)
      return;
    cancelSent.current = true;
    void backend?.Cancel().catch(() => {
      cancelSent.current = false;
      setCancelling(false);
    });
  }, [backend, cancelling, status.phase]);

  async function run(next: Action) {
    if (!backend || activeAction.current) return;
    activeAction.current = next;
    revision.current++;
    setAction(next);
    try {
      await backend[next]();
      revision.current++;
      setStatus(await backend.Status());
    } catch {
      setStatus((state) => ({
        ...state,
        phase: errorPhase[next],
        problem: "",
      }));
    } finally {
      activeAction.current = undefined;
      setAction(undefined);
      cancelSent.current = false;
      setCancelling(false);
      if (closeAfterDownload.current) {
        closeAfterDownload.current = false;
        setOpen(false);
      }
    }
  }

  const phase = action ? actionPhase[action] : status.phase;
  function close() {
    if (phase === "installing") return;
    if (phase === "downloading") {
      closeAfterDownload.current = true;
      setCancelling(true);
      return;
    }
    setOpen(false);
  }

  return {
    enabled: Boolean(backend) && status.phase !== "unsupported",
    status,
    phase,
    open,
    cancelling,
    close,
    run,
    cancelDownload: () => setCancelling(true),
    notify: Boolean(status.version),
    show: () => setOpen(true),
    check: () => {
      setOpen(true);
      if (
        ![
          "checking",
          "downloading",
          "ready",
          "installing",
          "install-error",
        ].includes(phase)
      ) {
        void run("Check");
      }
    },
    notice,
    dismissNotice: () => setNotice(""),
  };
}

const titles: Record<string, string> = {
  checking: "Проверяем обновления…",
  current: "Установлена последняя версия",
  unavailable: "Обновление недоступно",
  available: "Доступно обновление",
  downloading: "Загрузка обновления",
  ready: "Обновление готово",
  installing: "Подготавливаем перезапуск…",
  "check-error": "Не удалось проверить обновления",
  "download-error": "Не удалось обновить приложение",
  "install-error": "Не удалось обновить приложение",
};
const problems: Record<string, string> = {
  feed: "Проверьте подключение к интернету и повторите проверку. GitHub может быть временно недоступен.",
  manifest: "Не удалось подтвердить подлинность данных о выпуске.",
  space: "Недостаточно свободного места на диске.",
  permission: "Приложению не хватает прав на запись.",
  integrity:
    "Размер или контрольная сумма файла не совпадают с данными выпуска.",
  download:
    "Загрузка прервалась. Проверьте подключение к интернету и повторите попытку.",
  prepare:
    "Не удалось подготовить замену приложения. Проверьте доступ к папке установки.",
};
const formatSize = (bytes: number) =>
  (bytes / 1024 ** 2).toLocaleString("ru-RU", { maximumFractionDigits: 1 }) +
  " МБ";

export function UpdateDialog({
  update,
}: {
  update: ReturnType<typeof useUpdates>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { status, phase, open, cancelling, close, run } = update;
  const [confirm, setConfirm] = useState(false);

  useLayoutEffect(() => {
    if (!open) return;
    const element = dialog.current!;
    const previous = document.activeElement;
    element.showModal();
    heading.current?.focus();
    return () => {
      element.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [open]);

  useLayoutEffect(() => {
    if (open && !dialog.current?.contains(document.activeElement))
      heading.current?.focus();
  }, [open, phase, confirm]);

  if (!open) return null;
  const retry =
    phase === "check-error"
      ? "Check"
      : phase === "download-error"
        ? "Download"
        : phase === "install-error"
          ? "Install"
          : undefined;

  function dismiss() {
    setConfirm(false);
    close();
  }

  return (
    <dialog
      ref={dialog}
      className="update-dialog"
      aria-labelledby="update-title"
      onCancel={(event) => {
        event.preventDefault();
        dismiss();
      }}
    >
      <div className="update-shell">
        <div>
          <h2 ref={heading} tabIndex={-1} id="update-title" aria-live="polite">
            {confirm && phase === "ready"
              ? "Перезапустить Find a Note?"
              : (titles[phase] ?? "Обновления Find a Note")}
          </h2>
          <p className="update-version">
            {product.productName} {status.version || product.productVersion}
          </p>
        </div>
        <div className="update-body">
          {phase === "available" && (
            <>
              <p className="update-muted">
                Установлена версия {product.productVersion}
              </p>
              {status.notes && (
                <>
                  <h3>Что нового</h3>
                  <div
                    className="update-notes"
                    tabIndex={0}
                    role="region"
                    aria-label="Что нового"
                  >
                    {status.notes}
                  </div>
                </>
              )}
            </>
          )}
          {phase === "unavailable" && (
            <p>Для этого варианта приложения нет подходящего пакета.</p>
          )}
          {phase === "downloading" && (
            <>
              <progress
                aria-label="Загрузка обновления"
                max={100}
                value={status.total > 0 ? status.progress : undefined}
              />
              <p className="update-muted">
                {cancelling
                  ? "Отменяем загрузку…"
                  : status.total > 0
                    ? `${status.progress}% · Загружено ${formatSize(status.received)} из ${formatSize(status.total)}`
                    : `Загружено ${formatSize(status.received)}`}
              </p>
            </>
          )}
          {phase === "ready" && (
            <p>
              {confirm
                ? "Текущая тренировка завершится. Приложение откроется снова после обновления."
                : "Новая версия загружена и проверена. Для завершения установки перезапустите приложение."}
            </p>
          )}
          {retry && (
            <p role="alert">
              {problems[status.problem] ??
                problems[
                  retry === "Check"
                    ? "feed"
                    : retry === "Download"
                      ? "download"
                      : "prepare"
                ]}
            </p>
          )}
        </div>
        <div className="update-actions">
          {phase === "available" ? (
            <>
              <button onClick={dismiss}>Позже</button>
              <button
                className="update-primary"
                onClick={() => void run("Download")}
              >
                Обновить
              </button>
            </>
          ) : phase === "downloading" ? (
            <button disabled={cancelling} onClick={update.cancelDownload}>
              Отмена
            </button>
          ) : phase === "ready" ? (
            confirm ? (
              <>
                <button onClick={() => setConfirm(false)}>Назад</button>
                <button
                  className="update-primary"
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
                <button onClick={dismiss}>Позже</button>
                <button
                  className="update-primary"
                  onClick={() => setConfirm(true)}
                >
                  Перезапустить
                </button>
              </>
            )
          ) : (
            phase !== "installing" && (
              <>
                <button onClick={dismiss}>Закрыть</button>
                {retry && (
                  <button
                    className="update-primary"
                    onClick={() => void run(retry)}
                  >
                    Повторить
                  </button>
                )}
              </>
            )
          )}
        </div>
      </div>
    </dialog>
  );
}

export function UpdateNotice({
  update,
}: {
  update: ReturnType<typeof useUpdates>;
}) {
  if (!update.notice) return null;
  return (
    <div
      className="update-notice"
      role="complementary"
      aria-label="Результат обновления"
    >
      <div role="status">
        <strong>
          {update.notice === "updated"
            ? "Find a Note обновлён"
            : "Предыдущая версия восстановлена"}
        </strong>
        <p>Версия {product.productVersion}</p>
      </div>
      <button onClick={update.dismissNotice}>Понятно</button>
    </div>
  );
}

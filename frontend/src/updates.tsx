import {
  LanguageSelect,
  type MessageKey,
  localizedNotes,
  useLanguage,
} from "./i18n";
// SPDX-License-Identifier: GPL-3.0-only
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { info as product } from "../../wails.json";
import { BrowserOpenURL } from "../wailsjs/runtime/runtime";
import "./updates.css";

type Status = {
  phase: string;
  version: string;
  notes: string;
  progress: number;
  received: number;
  total: number;
  problem: string;
  manual?: boolean;
  macOS?: boolean;
  verifiedSHA256?: string;
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
    a.problem === b.problem &&
    a.manual === b.manual &&
    a.macOS === b.macOS &&
    a.verifiedSHA256 === b.verifiedSHA256
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
        !["checking", "downloading", "installing", "install-error"].includes(
          phase,
        ) &&
        (phase !== "ready" || status.manual)
      ) {
        void run("Check");
      }
    },
    notice,
    dismissNotice: () => setNotice(""),
  };
}

const titles: Partial<Record<string, MessageKey>> = {
  checking: "checking-for-updates",
  current: "youre-up-to-date",
  unavailable: "update-unavailable",
  available: "update-available",
  downloading: "downloading-update",
  ready: "update-ready",
  installing: "preparing-to-restart",
  "check-error": "could-not-check-for-updates",
  "download-error": "could-not-update-the-app",
  "install-error": "could-not-update-the-app",
};
const problems: Partial<Record<string, MessageKey>> = {
  feed: "update-feed-error",
  manifest: "update-manifest-error",
  space: "update-space-error",
  permission: "update-permission-error",
  integrity: "update-integrity-error",
  download: "update-download-error",
  prepare: "update-prepare-error",
  pending: "update-macos-pending",
};

export function UpdateDialog({
  update,
}: {
  update: ReturnType<typeof useUpdates>;
}) {
  const { t, language } = useLanguage();
  const formatSize = (bytes: number) =>
    t("size-mb", {
      size: (bytes / 1024 ** 2).toLocaleString(language, {
        maximumFractionDigits: 1,
      }),
    });
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const { status, phase, open, cancelling, close, run } = update;
  const notes = localizedNotes(status.notes, language);
  const manualReady =
    phase === "ready" && status.manual && status.verifiedSHA256;
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
              ? t("restart-find-a-note")
              : t(titles[phase] ?? "find-a-note-updates")}
          </h2>
          <p className="update-version">
            {product.productName} {status.version || product.productVersion}
          </p>
        </div>
        <div className="update-body">
          {(phase === "available" || manualReady) && (
            <>
              <p className="update-muted">
                {t("installed-version", { version: product.productVersion })}
              </p>
              {notes && (
                <>
                  <h3>{t("whats-new")}</h3>
                  <div
                    className="update-notes"
                    tabIndex={0}
                    role="region"
                    aria-label={t("whats-new")}
                  >
                    {notes}
                  </div>
                </>
              )}
            </>
          )}
          {phase === "unavailable" && <p>{t("update-package-unavailable")}</p>}
          {status.macOS && status.manual && phase === "available" && <p>{t("update-macos-manual-location")}</p>}
          {phase === "downloading" && (
            <>
              <progress
                aria-label={t("downloading-update")}
                max={100}
                value={status.total > 0 ? status.progress : undefined}
              />
              <p className="update-muted">
                {cancelling
                  ? t("canceling-download")
                  : status.total > 0
                    ? t("download-progress", {
                        progress: status.progress,
                        received: formatSize(status.received),
                        total: formatSize(status.total),
                      })
                    : t("download-bytes", {
                        received: formatSize(status.received),
                      })}
              </p>
            </>
          )}
          {manualReady && (
            <>
              <p>{t("update-manual-explainer")}</p>
              <p className="update-muted">{t("update-macos-gatekeeper")}</p>
              <p className="update-muted">
                SHA-256{" "}
                <code className="update-digest">{status.verifiedSHA256}</code>
              </p>
            </>
          )}
          {status.macOS && phase === "installing" && <p>{t("update-macos-preparing")}</p>}
          {phase === "ready" && !status.manual && (
            <p>
              {confirm
                ? t(status.macOS ? "update-macos-confirm" : "update-restart-confirmation")
                : t("update-ready-explainer")}
            </p>
          )}
          {retry && (
            <p role="alert">
              {t(
                problems[status.problem] ??
                  problems[
                    retry === "Check"
                      ? "feed"
                      : retry === "Download"
                        ? "download"
                        : "prepare"
                  ]!,
              )}
            </p>
          )}
        </div>
        <div className="update-actions">
          {phase === "available" ? (
            <>
              <button onClick={dismiss}>{t("later")}</button>
              <button
                className="update-primary"
                onClick={() => void run("Download")}
              >
                {t(status.manual ? "update-verify-dmg" : "update")}
              </button>
            </>
          ) : phase === "downloading" ? (
            <button disabled={cancelling} onClick={update.cancelDownload}>
              {t("cancel")}
            </button>
          ) : manualReady ? (
            <>
              <button onClick={dismiss}>{t("close")}</button>
              <button
                className="update-primary"
                onClick={() =>
                  BrowserOpenURL(
                    `https://github.com/pembrock/find-a-note/releases/tag/v${status.version}`,
                  )
                }
              >
                {t("update-open-release")}
              </button>
            </>
          ) : phase === "ready" && !status.manual ? (
            confirm ? (
              <>
                <button onClick={() => setConfirm(false)}>{t("back")}</button>
                <button
                  className="update-primary"
                  onClick={() => {
                    setConfirm(false);
                    void run("Install");
                  }}
                >
                  {t("confirm-restart")}
                </button>
              </>
            ) : (
              <>
                <button onClick={dismiss}>{t("later")}</button>
                <button
                  className="update-primary"
                  onClick={() => setConfirm(true)}
                >
                  {t("restart")}
                </button>
              </>
            )
          ) : (
            phase !== "installing" && (
              <>
                <button onClick={dismiss}>{t("close")}</button>
                {retry && (
                  <button
                    className="update-primary"
                    onClick={() => void run(retry)}
                  >
                    {t("retry")}
                  </button>
                )}
              </>
            )
          )}
        </div>
        {phase !== "installing" && <LanguageSelect />}
      </div>
    </dialog>
  );
}

export function UpdateNotice({
  update,
}: {
  update: ReturnType<typeof useUpdates>;
}) {
  const { t } = useLanguage();
  if (!update.notice) return null;
  return (
    <div
      className="update-notice"
      role="complementary"
      aria-label={t("update-result")}
    >
      <div role="status">
        <strong>
          {update.notice === "updated"
            ? t("find-a-note-updated")
            : t("previous-version-restored")}
        </strong>
        <p>{t("version", { version: product.productVersion })}</p>
      </div>
      <button onClick={update.dismissNotice}>{t("ok")}</button>
    </div>
  );
}

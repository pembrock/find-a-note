import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

const storageKey = "sonari.settings.sections.v1";
export type SectionId = "general" | "sound" | "display" | "range" | "notation" | "training";
const ids: SectionId[] = ["general", "sound", "display", "range", "notation", "training"];
type Expanded = Partial<Record<SectionId, boolean>>;
function load(): Expanded {
  try {
    const value = JSON.parse(localStorage.getItem(storageKey) ?? "null");
    if (
      value?.version !== 1 ||
      !value.expanded ||
      typeof value.expanded !== "object"
    )
      return {};
    return Object.fromEntries(
      ids.filter((id) => value.expanded[id] === true).map((id) => [id, true]),
    );
  } catch {
    return {};
  }
}
export function useSettingsSections() {
  const [expanded, setExpanded] = useState(load);
  const [saveError, setSaveError] = useState(false);
  function toggle(id: SectionId) {
    const next = { ...expanded, [id]: !expanded[id] };
    setExpanded(next);
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ version: 1, expanded: next }),
      );
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  }
  return {
    saveError,
    props: (id: SectionId) => ({
      expanded: expanded[id] === true,
      onToggle: () => toggle(id),
    }),
  };
}
export function SettingsSection({
  title,
  icon,
  expanded,
  onToggle,
  children,
}: {
  title: string;
  icon?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="settings-section">
      <h3>
        <button
          type="button"
          className="section-trigger"
          id={`${id}-heading`}
          aria-expanded={expanded}
          aria-controls={`${id}-content`}
          onClick={onToggle}
        >
          {icon}
          <span>{title}</span>
          <ChevronDown className="section-chevron" aria-hidden="true" />
        </button>
      </h3>
      <div
        id={`${id}-content`}
        aria-labelledby={`${id}-heading`}
        hidden={!expanded}
        className="section-content"
      >
        {children}
      </div>
    </section>
  );
}

import * as Select from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";

type Option = { value: string; label: string; disabled?: boolean };
export function SelectField({
  label,
  value,
  options,
  onChange,
  disabled = false,
}: {
  label: string;
  value: string;
  options: Option[];
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="field">
      <span>{label}</span>
      <Select.Root value={value} onValueChange={onChange} disabled={disabled}>
        <Select.Trigger className="select-trigger" aria-label={label}>
          <Select.Value />
          <Select.Icon>
            <ChevronDown size={15} />
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content
            className="select-content"
            position="popper"
            sideOffset={6}
            collisionPadding={12}
          >
            <Select.ScrollUpButton className="select-scroll">
              <ChevronUp size={15} />
            </Select.ScrollUpButton>
            <Select.Viewport className="select-viewport">
              {options.map((o) => (
                <Select.Item
                  className="select-item"
                  value={o.value}
                  key={o.value}
                  disabled={o.disabled}
                >
                  <Select.ItemText>{o.label}</Select.ItemText>
                  <Select.ItemIndicator className="select-check">
                    <Check size={14} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="select-scroll">
              <ChevronDown size={15} />
            </Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
    </div>
  );
}

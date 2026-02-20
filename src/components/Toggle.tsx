import type { ReactNode } from 'react';

export function Toggle({ checked, onChange, label, labelSuffix }: {
  checked: boolean;
  onChange: (val: boolean) => void;
  label?: ReactNode;
  labelSuffix?: ReactNode;
}) {
  return (
    <div className="toggle-wrapper">
      <div className={`toggle ${checked ? 'active' : ''}`} onClick={() => onChange(!checked)}>
        <div className="toggle-knob" />
      </div>
      {label && <span className="form-label">{label}</span>}
      {labelSuffix}
    </div>
  );
}

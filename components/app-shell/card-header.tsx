import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

/** A panel's title row: heading on the left, a decorative round icon badge on the right. */
export function CardHeader({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="card-header">
      <div className="min-w-0">{children}</div>
      <span className="icon-badge">
        <Icon name={icon} size={16} />
      </span>
    </div>
  );
}

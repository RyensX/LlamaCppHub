import type { ElementType } from "react";
import { Server } from "lucide-react";

interface EmptyStateProps {
  icon?: ElementType;
  title: string;
  description?: string;
}

export default function EmptyState({ icon: Icon = Server, title, description }: EmptyStateProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <Icon className="h-16 w-16 opacity-30" />
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="text-xs">{description}</p>}
    </div>
  );
}

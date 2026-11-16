import { Suspense } from "react";
import { AppShell } from "@/components/AppShell";
import { DebriefView } from "@/components/DebriefView";

export default function DebriefPage() {
  return (
    <AppShell>
      <Suspense fallback={<div className="row" role="status"><span className="spinner" aria-hidden="true" /> Loading your debrief</div>}>
        <DebriefView />
      </Suspense>
    </AppShell>
  );
}

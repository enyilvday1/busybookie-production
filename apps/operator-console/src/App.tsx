import { OverviewPage } from "./pages/OverviewPage";
import { AppShell } from "./shell/AppShell";

export function App() {
  return (
    <AppShell currentNavigationId="overview">
      <OverviewPage />
    </AppShell>
  );
}

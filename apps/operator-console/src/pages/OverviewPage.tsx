import { EmptyState, PageHeader } from "../design-system";

// D2 is intentionally not connected to production data. These strings are
// frozen by the D2 contract (Step 992A section 4) and mean only that.
export const OVERVIEW_EMPTY_TITLE = "Production views aren't connected yet";
export const OVERVIEW_EMPTY_DESCRIPTION =
  "This interface foundation is ready. Episode and production data will appear here after the read-only operator connection is introduced in the next milestone.";

export function OverviewPage() {
  return (
    <>
      <PageHeader title="Overview" />
      <EmptyState title={OVERVIEW_EMPTY_TITLE} description={OVERVIEW_EMPTY_DESCRIPTION} />
    </>
  );
}

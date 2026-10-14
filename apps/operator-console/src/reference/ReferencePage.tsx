import { Menu } from "lucide-react";

import {
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  PageHeader,
  Panel,
  Skeleton,
  STATUS_TONES,
  StatusIndicator,
  TextField,
} from "../design-system";

// Development-only design-system reference (reference.html, not a production
// build input and not in production navigation). All content is static,
// clearly labelled example text: no API, no production state, no credentials.
export function ReferencePage() {
  return (
    <main id="main-content" tabIndex={-1}>
      <div>
        <PageHeader
          title="Design system reference"
          description="Development-only view of every console primitive and state. All values on this page are static examples."
        />

        <Panel title="Buttons">
          <div>
            <Button variant="primary">Primary</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="primary" size="sm">
              Primary small
            </Button>
            <Button variant="secondary" disabled>
              Disabled
            </Button>
            <IconButton label="Example icon button" icon={Menu} />
          </div>
        </Panel>

        <Panel title="Text fields">
          <div>
            <TextField label="Example text field" description="Static example with a description." />
            <TextField label="Example field with an error" error="Example validation message." />
          </div>
        </Panel>

        <Panel title="Status indicators">
          <ul>
            {STATUS_TONES.map((tone) => (
              <li key={tone}>
                <StatusIndicator tone={tone} label={`Example ${tone} status`} />
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Empty state">
          <EmptyState
            headingLevel={3}
            title="Example: no items exist"
            description="Shown only when a request succeeded and returned no items."
          />
        </Panel>

        <Panel title="Loading state">
          <LoadingState subject="example items" />
        </Panel>

        <Panel title="Skeleton widths">
          <div>
            <Skeleton width="full" />
            <Skeleton width="half" />
            <Skeleton width="quarter" />
          </div>
        </Panel>

        <Panel title="Error state">
          <ErrorState
            title="Example: state could not be read"
            code="STATE_UNAVAILABLE"
            message="Example message. Real error states show only the API's fixed message."
            requestId="00000000-0000-4000-8000-000000000000"
          />
        </Panel>
      </div>
    </main>
  );
}

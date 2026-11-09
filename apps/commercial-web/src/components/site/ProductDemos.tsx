import {
  AudioLines,
  BookOpen,
  Check,
  Clapperboard,
  FileText,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  Megaphone,
  Puzzle,
  Shapes,
  Share2,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { SceneThumb, Waveform } from "./Illustrations";
import { DemoStatusChip, ProductDemoFrame, type DemoStatus } from "./ProductDemoFrame";

// Fictional sample project used only inside conceptual previews.
const SAMPLE_PROJECT = "The Lantern Fox";

const NAV: readonly { icon: LucideIcon; label: string; active?: boolean }[] = [
  { icon: LayoutGrid, label: "Overview" },
  { icon: FileText, label: "Story" },
  { icon: Users, label: "Characters" },
  { icon: Clapperboard, label: "Scenes", active: true },
  { icon: AudioLines, label: "Audio" },
  { icon: Share2, label: "Outputs" },
];

const PIPELINE: readonly { label: string; state: "done" | "current" | "next" }[] = [
  { label: "Brief", state: "done" },
  { label: "Story", state: "done" },
  { label: "Scenes", state: "current" },
  { label: "Audio", state: "next" },
  { label: "Outputs", state: "next" },
];

const SCENES: readonly { variant: 0 | 1 | 2 | 3; label: string }[] = [
  { variant: 0, label: "Forest path" },
  { variant: 1, label: "Lantern glow" },
  { variant: 2, label: "Owl's hollow" },
  { variant: 3, label: "Home burrow" },
];

const OUTPUTS: readonly { icon: LucideIcon; name: string; status: DemoStatus }[] = [
  { icon: Clapperboard, name: "Animated short", status: "progress" },
  { icon: BookOpen, name: "Picture book", status: "ready" },
  { icon: Puzzle, name: "Activity pack", status: "planned" },
  { icon: Megaphone, name: "Social cut-downs", status: "planned" },
];

/** Home hero preview: an integrated production workspace for one project. */
export function HeroStudioPreview() {
  return (
    <ProductDemoFrame
      className="demo-frame--hero"
      windowTitle={`${SAMPLE_PROJECT} · Production`}
      caption="Conceptual preview with a fictional project: one workspace holding the story, characters, storyboard scenes, narration and planned outputs (video, picture book, activity pack and social cut-downs)."
    >
      <div className="studio">
        <div className="studio__nav">
          <span className="studio__project">
            <span className="studio__project-mark" />
            {SAMPLE_PROJECT}
          </span>
          <ul>
            {NAV.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.label} className={item.active === true ? "is-active" : undefined}>
                  <Icon size={15} focusable="false" />
                  {item.label}
                </li>
              );
            })}
          </ul>
        </div>

        <div className="studio__main">
          <div className="studio__head">
            <div>
              <p className="studio__kicker">Episode 1 · Bedtime series</p>
              <p className="studio__title">Scenes & storyboard</p>
            </div>
            <ol className="studio__pipeline">
              {PIPELINE.map((stage) => (
                <li key={stage.label} className={`pipeline-stage pipeline-stage--${stage.state}`}>
                  <span className="pipeline-stage__dot">{stage.state === "done" ? <Check size={10} strokeWidth={3} focusable="false" /> : null}</span>
                  {stage.label}
                </li>
              ))}
            </ol>
          </div>

          <div className="studio__grid">
            <div className="studio-panel studio-panel--characters">
              <p className="studio-panel__label">Characters</p>
              <div className="studio-character">
                <span className="demo-avatar demo-avatar--fox" />
                <span>
                  <strong>Juniper</strong>
                  <span>Fox · lead</span>
                </span>
              </div>
              <div className="studio-character">
                <span className="demo-avatar demo-avatar--badger" />
                <span>
                  <strong>Bram</strong>
                  <span>Badger · friend</span>
                </span>
              </div>
              <p className="studio-panel__note">Style: soft gouache, dusk palette</p>
            </div>

            <div className="studio-panel studio-panel--scenes">
              <p className="studio-panel__label">Storyboard</p>
              <ul className="studio-scenes">
                {SCENES.map((scene, index) => (
                  <li key={scene.label}>
                    <SceneThumb variant={scene.variant} />
                    <span>
                      {index + 1}. {scene.label}
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="studio-panel studio-panel--audio">
              <p className="studio-panel__label">Narration</p>
              <Waveform />
              <p className="studio-panel__note">Read-aloud take · Scene 1</p>
            </div>

            <div className="studio-panel studio-panel--outputs">
              <p className="studio-panel__label">Outputs</p>
              <ul className="studio-outputs">
                {OUTPUTS.map((output) => {
                  const Icon = output.icon;
                  return (
                    <li key={output.name}>
                      <span className="studio-outputs__icon">
                        <Icon size={14} focusable="false" />
                      </span>
                      <span className="studio-outputs__name">{output.name}</span>
                      <DemoStatusChip status={output.status} />
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </ProductDemoFrame>
  );
}

const STAGES: readonly { icon: LucideIcon; title: string; detail: string; status: DemoStatus }[] = [
  { icon: Lightbulb, title: "Concept", detail: "Brief, audience & formats", status: "ready" },
  { icon: ListChecks, title: "Story & planning", detail: "Outline and episode plan", status: "ready" },
  { icon: Shapes, title: "Characters & context", detail: "References and style notes", status: "ready" },
  { icon: Clapperboard, title: "Scenes & assets", detail: "Storyboard, backgrounds, props", status: "progress" },
  { icon: AudioLines, title: "Narration & media", detail: "Read-aloud, video, illustration", status: "planned" },
  { icon: Share2, title: "Outputs", detail: "Episode, book, worksheets, social", status: "planned" },
];

/** Solutions hero preview: one project moving through connected stages. */
export function WorkflowPreview() {
  return (
    <ProductDemoFrame
      className="demo-frame--workflow"
      windowTitle={`${SAMPLE_PROJECT} · Production plan`}
      caption="Conceptual preview with a fictional project: six connected stages from concept, story and characters to scenes, narration and outputs, each worked through inside one project."
    >
      <ol className="pipeline">
        {STAGES.map((stage, index) => {
          const Icon = stage.icon;
          return (
            <li key={stage.title} className={`pipeline__row pipeline__row--${stage.status}`}>
              <span className="pipeline__index">{String(index + 1).padStart(2, "0")}</span>
              <span className="pipeline__icon">
                <Icon size={18} focusable="false" />
              </span>
              <span className="pipeline__text">
                <span className="pipeline__title">{stage.title}</span>
                <span className="pipeline__detail">{stage.detail}</span>
              </span>
              <DemoStatusChip status={stage.status} />
            </li>
          );
        })}
      </ol>
      <div className="pipeline__context">
        <span className="pipeline__context-label">Shared context</span>
        <span className="pipeline__context-chips">
          <span>Juniper & Bram</span>
          <span>Dusk palette</span>
          <span>Ages 4–7</span>
        </span>
      </div>
    </ProductDemoFrame>
  );
}

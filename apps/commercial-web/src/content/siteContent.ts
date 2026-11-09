import {
  AudioLines,
  BookOpen,
  Captions,
  Clapperboard,
  FileText,
  GraduationCap,
  Image,
  Layers,
  LayoutTemplate,
  ListChecks,
  Megaphone,
  Package,
  Palette,
  PenLine,
  Shapes,
  Share2,
  Trees,
  type LucideIcon,
} from "lucide-react";

// Public marketing copy shared by more than one page. Everything here
// describes the platform's intended production model; nothing states a
// quota, price, provider, model or customer metric.

/** Provisional decorative accent families (see tokens.css). Never carries meaning on its own. */
export type Accent = "violet" | "indigo" | "teal" | "peach" | "rose" | "amber";

export type ContentFamily = {
  id: "stories-publishing" | "video-entertainment" | "education-learning" | "characters-ip" | "audio-narration" | "marketing-social";
  name: string;
  icon: LucideIcon;
  accent: Accent;
  /** Very short descriptor for the compact category strip. */
  stripLine: string;
  summary: string;
  examples: readonly string[];
  /** Production assets this family typically draws on. */
  assets: readonly string[];
};

export const CONTENT_FAMILIES: readonly ContentFamily[] = [
  {
    id: "stories-publishing",
    name: "Stories & Publishing",
    icon: BookOpen,
    accent: "violet",
    stripLine: "Books, stories & activity packs",
    summary: "Picture books, illustrated stories and printable activity books, developed from one story world.",
    examples: ["Picture books", "Illustrated stories", "Colouring pages", "Activity packs"],
    assets: ["Outlines", "Manuscripts", "Character references", "Page layouts"],
  },
  {
    id: "video-entertainment",
    name: "Video & Entertainment",
    icon: Clapperboard,
    accent: "indigo",
    stripLine: "Shorts, episodes & explainers",
    summary: "Animated shorts, episodes and explainers, planned from script and storyboard through to the final cut.",
    examples: ["Animated shorts", "Episodic series", "Song and rhyme videos", "Explainers"],
    assets: ["Scripts", "Storyboards", "Shot plans", "Backgrounds"],
  },
  {
    id: "education-learning",
    name: "Education & Learning",
    icon: GraduationCap,
    accent: "teal",
    stripLine: "Worksheets, puzzles & lessons",
    summary: "Lessons, worksheets and printable resources that share the characters and visuals learners already know.",
    examples: ["Worksheets", "Puzzles & mazes", "Printable games", "Lesson explainers"],
    assets: ["Learning outlines", "Templates", "Illustrations", "Narration"],
  },
  {
    id: "characters-ip",
    name: "Characters & Creative IP",
    icon: Shapes,
    accent: "peach",
    stripLine: "Characters, worlds & style guides",
    summary: "Characters and worlds developed once, with references and style notes the rest of the production draws on.",
    examples: ["Character sheets", "Story worlds", "Expression sets", "Style guides"],
    assets: ["Character references", "Brand styles", "Props", "Settings"],
  },
  {
    id: "audio-narration",
    name: "Audio & Narration",
    icon: AudioLines,
    accent: "rose",
    stripLine: "Narration, dialogue & read-alongs",
    summary: "Narration, dialogue and read-alongs, planned alongside the scripts and stories they belong to.",
    examples: ["Narrated stories", "Character dialogue", "Read-alongs", "Subtitles"],
    assets: ["Dialogue", "Narration scripts", "Subtitles", "Pronunciation notes"],
  },
  {
    id: "marketing-social",
    name: "Marketing & Social Media",
    icon: Megaphone,
    accent: "amber",
    stripLine: "Social, trailers & campaigns",
    summary: "Trailers, social cut-downs and campaign visuals for family brands, drawn from the same project.",
    examples: ["Social cut-downs", "Trailers & teasers", "Campaign visuals", "Branded activity sheets"],
    assets: ["Templates", "Brand styles", "Reusable visuals", "Export presets"],
  },
];

export type WorkflowStepContent = {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
};

export const WORKFLOW_STEPS: readonly WorkflowStepContent[] = [
  {
    id: "brief",
    title: "Idea & brief",
    description: "Capture the audience, tone, formats and goals for the production.",
    icon: PenLine,
  },
  {
    id: "planning",
    title: "Planning",
    description: "Shape the story, characters or learning content before anything is made.",
    icon: ListChecks,
  },
  {
    id: "assets",
    title: "Production assets",
    description: "Scripts, storyboards, references, backgrounds and narration as editable assets.",
    icon: FileText,
  },
  {
    id: "creation",
    title: "Media creation",
    description: "Produce video, illustration, audio and printables from those assets.",
    icon: Clapperboard,
  },
  {
    id: "context",
    title: "Shared context",
    description: "Characters, style and audience notes stay with the project for every output.",
    icon: Layers,
  },
  {
    id: "outputs",
    title: "Multiple outputs",
    description: "Turn one production into an episode, a book, worksheets and social cuts.",
    icon: Share2,
  },
  {
    id: "publish",
    title: "Publish-ready assets",
    description: "Organised files prepared for your social channels, publishing platforms, printers and other delivery tools.",
    icon: Package,
  },
];

export type EntryModel = {
  id: "byo" | "hosted";
  kicker: string;
  name: string;
  headline: string;
  points: readonly string[];
  billingLabel: string;
  billingValue: string;
  status: string;
};

export const ENTRY_MODELS: readonly EntryModel[] = [
  {
    id: "byo",
    kicker: "Free entry",
    name: "Free BYO Provider",
    headline: "Build your first production free.",
    points: [
      "Connect a supported generation provider account of your own.",
      "Use the platform's production workflow: briefs, planning, assets and outputs.",
      "Generation is billed by your provider directly to you, under your agreement with them.",
    ],
    billingLabel: "Who bills generation",
    billingValue: "Your provider, directly",
    status: "Supported providers to be confirmed",
  },
  {
    id: "hosted",
    kicker: "Free entry",
    name: "Hosted Trial",
    headline: "Try one bounded hosted experience.",
    points: [
      "One tightly bounded hosted experience, where available.",
      "No provider account needed for that single experience.",
      "Not unlimited, not a recurring monthly allowance and not guaranteed for every account.",
    ],
    billingLabel: "Who bills generation",
    billingValue: "Platform-covered generation may be available in a tightly bounded trial",
    status: "Availability, scope and eligibility to be confirmed",
  },
];

export type Audience = {
  id: string;
  title: string;
  icon: LucideIcon;
  accent: Accent;
  body: string;
  /** Example formats this audience typically produces. */
  formats: readonly [string, string];
};

// Audience categories the platform is designed for. Not customers, not testimonials.
export const AUDIENCES: readonly Audience[] = [
  {
    id: "creators",
    title: "Independent Creators",
    icon: PenLine,
    accent: "violet",
    body: "Take one story from idea to picture book, read-along and activity pages, with the characters kept in the project.",
    formats: ["Picture books", "Read-alongs"],
  },
  {
    id: "publishers",
    title: "Publishers",
    icon: BookOpen,
    accent: "indigo",
    body: "Develop series, illustrated editions and companion printables from shared story and style references.",
    formats: ["Series", "Activity books"],
  },
  {
    id: "educators",
    title: "Educators",
    icon: GraduationCap,
    accent: "teal",
    body: "Pair lesson explainers with worksheets, puzzles and printable games built around the same characters.",
    formats: ["Worksheets", "Explainers"],
  },
  {
    id: "studios",
    title: "Agencies & Studios",
    icon: Clapperboard,
    accent: "rose",
    body: "Keep scripts, storyboards, shot plans and references organised in one project from development to delivery.",
    formats: ["Storyboards", "Shot plans"],
  },
  {
    id: "brands",
    title: "Family & Character Brands",
    icon: Shapes,
    accent: "peach",
    body: "Extend characters and brand styles into campaign visuals, social cut-downs and branded activity sheets.",
    formats: ["Campaigns", "Social"],
  },
];

export type ProductionAsset = {
  title: string;
  icon: LucideIcon;
  accent: Accent;
  body: string;
};

// The production infrastructure behind outputs. Describes asset types only:
// no versioning, approval or collaboration systems are claimed.
export const PRODUCTION_ASSETS: readonly ProductionAsset[] = [
  {
    title: "Templates",
    icon: LayoutTemplate,
    accent: "violet",
    body: "Reusable layouts for pages, worksheets and social formats.",
  },
  {
    title: "Storyboards",
    icon: Clapperboard,
    accent: "indigo",
    body: "Panel-by-panel plans that turn a script into scenes.",
  },
  {
    title: "Scene & shot plans",
    icon: ListChecks,
    accent: "teal",
    body: "Scene breakdowns and shot plans that guide media creation.",
  },
  {
    title: "Reusable visual assets",
    icon: Image,
    accent: "peach",
    body: "Character references and illustrations kept for the next output.",
  },
  {
    title: "Backgrounds & props",
    icon: Trees,
    accent: "amber",
    body: "Settings and objects that belong to the story world.",
  },
  {
    title: "Audio & narration",
    icon: AudioLines,
    accent: "rose",
    body: "Narration scripts, dialogue and read-aloud planning.",
  },
  {
    title: "Subtitles",
    icon: Captions,
    accent: "indigo",
    body: "Subtitle and transcript text prepared alongside the script.",
  },
  {
    title: "Brand styles",
    icon: Palette,
    accent: "violet",
    body: "Palettes, type and visual rules for consistent presentation.",
  },
  {
    title: "Publish-ready assets",
    icon: Package,
    accent: "teal",
    body: "Organised files prepared for your social channels, publishing platforms, printers and other delivery tools.",
  },
];

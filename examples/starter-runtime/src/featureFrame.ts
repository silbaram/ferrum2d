import catalog from "../../shared/featureCatalog.json";
import topics from "../../shared/featureTopics.json";
import { galleryLink } from "../../shared/exampleHeader";
import {
  createStageHead, createTrySection, createWatchSection, hint, iconButton, moreBlock, mountStageColumn, sentences, setIconButton,
} from "../../shared/exampleFrame";
import { createRuntimeDemoShell, type RuntimeDemoShell } from "../../shared/runtimeDemoShell";
import { createFeatureNavigation } from "./featureNavigation";
import { createFeatureCode } from "./featureCode";
import { createFeatureLesson } from "./featureLesson";
import "./featureLab.css";

type Feature = (typeof catalog)[number];

export interface FeatureFrameOptions {
  /** Settings form markup for this experiment. */
  controls: string;
  /** Markup after the form inside "해 보기", such as a control error or a download link. */
  after?: string;
  /** What the pointer or keys do on the canvas. Omit it when the controls already say it. */
  help?: string;
  /** Lab sources, relative to the lab folder, that apply this experiment's controls. */
  sources: readonly string[];
  /** Placeholder for the rendering numbers until the first frame. */
  statistics: string;
}

export interface FeatureFrame {
  shell: RuntimeDemoShell;
  root: HTMLElement;
  panel: HTMLElement;
  lesson: ReturnType<typeof createFeatureLesson>;
  /** Rendering numbers, in "더 보기 › 엔진 수치". */
  statistics: HTMLParagraphElement;
  /** Show the pause button as pause or resume. */
  setPaused(paused: boolean): void;
  /** Disposers for the frame, run after the page's own. */
  cleanups: Array<() => void>;
}

/** The lab's detail frame, shared by the scene and spatial experiments: the experiment and one sentence
 * over the stage with the renderer and playback buttons, "해 보기" and "볼 것" beside it, previous/next
 * under it, and "더 보기" (description, scene JSON, API, sources, engine numbers) under the layout. */
export function createFeatureFrame(feature: Feature, options: FeatureFrameOptions): FeatureFrame {
  const topic = topics.find(item => item.id === feature.topic)!;
  const shell = createRuntimeDemoShell({ title: feature.title, exampleId: "starter-runtime", controls: false, metrics: [],
    trail: [{ text: topic.title, link: galleryLink(`topic:${topic.id}`) }] });
  const { canvas, stage } = shell;
  const root = stage.closest<HTMLElement>(".demo-shell")!;
  root.classList.add("feature-lab", "example-detail");
  document.title = `${feature.title} · Ferrum2D`;
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", `${feature.title} 실험 화면`);

  const toolbar = root.querySelector<HTMLElement>(".demo-toolbar")!;
  createStageHead(toolbar).set(feature.title, feature.summary);
  const run = document.createElement("div");
  run.className = "feature-top-actions example-run";
  run.innerHTML = `<span data-value="backend" role="status">준비 중…</span>
    <select data-control="renderer" aria-label="렌더러" title="렌더러"><option value="webgl2">WebGL2</option><option value="webgpu">WebGPU</option></select>`;
  const pause = iconButton("pause", "일시정지"); pause.dataset.control = "pause";
  const reset = iconButton("rotate-ccw", "실험 초기화"); reset.dataset.control = "reset";
  run.append(pause, reset);
  toolbar.append(run);

  const panel = document.createElement("aside");
  panel.className = "feature-panel example-panel";
  panel.setAttribute("aria-label", "해 보기와 볼 것");
  const tryHost = createTrySection();
  const form = document.createElement("form");
  form.className = "feature-controls";
  form.innerHTML = options.controls;
  tryHost.append(form);
  if (options.after) tryHost.insertAdjacentHTML("beforeend", options.after);
  if (options.help) tryHost.append(hint(options.help));
  const watch = createWatchSection();
  watch.set(sentences(feature.observe));
  panel.append(tryHost, watch.element);
  root.querySelector(".demo-metrics")!.replaceWith(panel);
  // Buttons in the settings form must never submit/reload the page.
  for (const button of panel.querySelectorAll("button")) button.type = "button";

  const about = document.createElement("div");
  about.className = "feature-about example-more-grid";
  const observation = document.createElement("output");
  observation.className = "feature-observation"; observation.dataset.value = "observation"; observation.textContent = "엔진 준비 중…";
  const statistics = document.createElement("p");
  statistics.className = "feature-statistics"; statistics.textContent = options.statistics;
  const engine = document.createElement("div");
  engine.className = "example-more-grid";
  engine.append(moreBlock("실험 값", observation), moreBlock("렌더링", statistics));

  const navigation = createFeatureNavigation(feature.id);
  const layout = root.querySelector<HTMLElement>(".demo-stage-layout")!;
  layout.prepend(navigation.element);
  mountStageColumn(stage, toolbar, navigation.pager);
  const code = createFeatureCode({ id: feature.id, api: feature.api, sources: options.sources, about, engine });
  layout.after(code.element);
  const lesson = createFeatureLesson(root, canvas, feature.id, feature.lesson, { actions: tryHost, about });
  return {
    shell, root, panel, lesson, statistics,
    setPaused: paused => setIconButton(pause, paused ? "play" : "pause", paused ? "계속하기" : "일시정지"),
    cleanups: [() => shell.destroy(), () => navigation.destroy(), () => code.destroy(), () => lesson.destroy()],
  };
}

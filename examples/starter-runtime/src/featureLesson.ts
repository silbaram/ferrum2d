import type { InputSnapshot } from "@ferrum2d/ferrum-web/core";
import { createLessonVisual } from "./featureLessonVisuals";
import type { LessonPoint, LessonPoses } from "./featureLessonGeometry";
import "./featureLesson.css";
export interface FeatureLessonSpec {
    useCase: string;
    scenario: string;
    steps: string[];
    legend: string[];
    actions: string[];
    roles: Array<{
        entity: string;
        label: string;
        tone: string;
        dx: number;
        dy: number;
        x: number;
        y: number;
    }>;
}
export interface LessonSample {
    observation: string;
    state?: object;
    poses: LessonPoses;
    project?: (point: LessonPoint) => {
        x: number;
        y: number;
    } | undefined;
    input?: InputSnapshot;
    viewport?: {
        worldMinX: number;
        worldMinY: number;
        cssWidth: number;
        cssHeight: number;
        zoom: number;
    };
}
export interface FeatureLessonHosts {
    /** "해 보기": the experiment's main action buttons move to its top. */
    actions: HTMLElement;
    /** "더 보기 › 설명": when to use it, the scene, the steps, how to read the stage and the comparison card. */
    about: HTMLElement;
}
const block = (title: string, ...content: Node[]) => {
    const section = document.createElement("section");
    section.className = "example-more-block";
    const heading = document.createElement("h3");
    heading.textContent = title;
    section.append(heading, ...content);
    return section;
};
const paragraph = (text: string, className?: string) => {
    const p = document.createElement("p");
    if (className)
        p.className = className;
    p.textContent = text;
    return p;
};
/** Lesson chrome and annotations only; engine owners keep inputs, state and resource lifetime. The stage keeps
 * the role labels and any status board drawn over the scene; the rest of the lesson waits in "더 보기". */
export function createFeatureLesson(root: HTMLElement, canvas: HTMLCanvasElement, id: string, spec: FeatureLessonSpec, hosts: FeatureLessonHosts) {
    root.dataset.featureTopic = id;
    const panel = root.querySelector<HTMLElement>(".feature-panel")!;
    const steps = document.createElement("ol");
    steps.className = "feature-lesson-steps";
    for (const text of spec.steps) {
        const item = document.createElement("li");
        item.textContent = text;
        steps.append(item);
    }
    const legend = document.createElement("ul");
    legend.className = "feature-lesson-legend";
    legend.setAttribute("aria-label", "화면 읽는 법");
    for (const text of spec.legend) {
        const item = document.createElement("li");
        item.textContent = text;
        legend.append(item);
    }
    const use = block("이럴 때 씁니다", paragraph(spec.useCase, "feature-use-case"), paragraph(spec.scenario, "feature-scenario"));
    const text = document.createElement("div");
    text.className = "feature-about-text";
    text.append(use, block("해 보는 순서", steps), block("화면 읽는 법", legend));
    const moved: Array<{
        node: Element;
        parent: Node;
        next: Node | null;
    }> = [];
    // Explanations written inside the settings form belong with the description.
    for (const node of panel.querySelectorAll("form > p")) {
        if (node.attributes.length) continue;
        moved.push({ node, parent: node.parentNode!, next: node.nextSibling });
        use.append(node);
    }
    const live = document.createElement("div");
    live.className = "feature-about-live";
    hosts.about.append(text, live);
    const actions = document.createElement("div");
    actions.className = "feature-lesson-actions example-guide-actions";
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", "화면에서 바로 해보기");
    for (const selector of spec.actions) {
        const nodes = root.querySelectorAll(selector);
        if (!nodes.length)
            throw Error(`Missing lesson action ${id}: ${selector}`);
        for (const node of nodes) {
            if (actions.contains(node))
                continue;
            moved.push({ node, parent: node.parentNode!, next: node.nextSibling });
            actions.append(node);
        }
    }
    if (actions.childElementCount)
        hosts.actions.querySelector("h2")!.after(actions);
    const scene = document.createElement("div");
    scene.className = "feature-scene";
    canvas.before(scene);
    scene.append(canvas);
    const annotations = document.createElement("div");
    annotations.className = "feature-role-labels";
    annotations.setAttribute("aria-hidden", "true");
    scene.append(annotations);
    const labels = spec.roles.map(role => {
        const label = document.createElement("span");
        label.textContent = role.label;
        label.dataset.tone = role.tone;
        label.dataset.entity = role.entity;
        label.hidden = true;
        annotations.append(label);
        return label;
    });
    const visual = createLessonVisual(id, root, scene, live);
    const feedback = document.createElement("p");
    feedback.className = "feature-lesson-feedback";
    feedback.setAttribute("aria-live", "off");
    feedback.hidden = true;
    feedback.textContent = "준비 중입니다.";
    live.append(feedback);
    // Bound the preview without stretching tall lessons or their canvas-relative overlays.
    const preview = document.createElement("div");
    preview.className = "feature-preview";
    preview.setAttribute("role", "region");
    preview.setAttribute("aria-label", "실험 결과 화면");
    preview.tabIndex = 0;
    preview.addEventListener("keydown", event => {
        if (event.target === preview) event.stopPropagation();
    });
    scene.before(preview);
    preview.append(scene);
    let destroyed = false;
    return {
        controlsHost: scene,
        entityIds: spec.roles.map(role => role.entity).filter(Boolean),
        update(sample: LessonSample) {
            if (destroyed)
                return;
            feedback.textContent = visual.update(sample) ?? sample.observation;
            feedback.hidden = feedback.textContent === sample.observation;
            const boxes: Array<{
                x: number;
                y: number;
                w: number;
                h: number;
            }> = [];
            spec.roles.forEach((role, index) => {
                const label = labels[index], point = role.entity ? sample.poses[role.entity] : role;
                const screen = point && sample.project?.(point);
                label.hidden = !screen || !Number.isFinite(screen.x + screen.y) || screen.x < 0 || screen.y < 0 || screen.x > canvas.clientWidth || screen.y > canvas.clientHeight;
                if (label.hidden || !screen)
                    return;
                const w = label.offsetWidth, h = label.offsetHeight;
                const x = Math.max(4, Math.min(canvas.clientWidth - w - 4, screen.x - w / 2 + role.dx));
                let y = Math.max(4, Math.min(canvas.clientHeight - h - 4, screen.y + role.dy));
                for (const box of boxes)
                    if (x < box.x + box.w && x + w > box.x && y < box.y + box.h && y + h > box.y)
                        y = Math.max(4, box.y - h - 4);
                boxes.push({ x, y, w, h });
                label.style.left = `${x}px`;
                label.style.top = `${y}px`;
            });
        },
        destroy() {
            if (destroyed)
                return;
            destroyed = true;
            visual.destroy();
            for (const item of moved.reverse())
                item.parent.insertBefore(item.node, item.next?.parentNode === item.parent ? item.next : null);
            actions.remove();
            annotations.remove();
            text.remove();
            live.remove();
            preview.replaceWith(canvas);
            delete root.dataset.featureTopic;
        },
    };
}

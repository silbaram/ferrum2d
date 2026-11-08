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
/** Lesson chrome and annotations only; engine owners keep inputs, state and resource lifetime. */
export function createFeatureLesson(root: HTMLElement, canvas: HTMLCanvasElement, id: string, spec: FeatureLessonSpec) {
    root.dataset.featureTopic = id;
    const stage = canvas.parentElement!, panel = root.querySelector<HTMLElement>(".feature-panel")!;
    const intro = document.createElement("section");
    intro.className = "feature-lesson-intro";
    intro.setAttribute("aria-label", "이 기능의 사용 상황");
    const eyebrow = document.createElement("span"), title = document.createElement("h2"), scenario = document.createElement("p");
    eyebrow.textContent = "게임에서 쓰는 곳";
    title.textContent = spec.useCase;
    scenario.textContent = spec.scenario;
    intro.append(eyebrow, title, scenario);
    canvas.before(intro);
    const steps = document.createElement("ol");
    steps.className = "feature-lesson-steps";
    for (const text of spec.steps) {
        const item = document.createElement("li");
        item.textContent = text;
        steps.append(item);
    }
    panel.querySelector("form")!.previousElementSibling!.replaceWith(steps);
    const actions = document.createElement("div");
    actions.className = "feature-lesson-actions";
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", "화면에서 바로 해보기");
    const moved: Array<{
        node: Element;
        parent: Node;
        next: Node | null;
    }> = [];
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
        intro.append(actions);
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
    const legend = document.createElement("ul");
    legend.className = "feature-lesson-legend";
    legend.setAttribute("aria-label", "화면 읽는 법");
    for (const text of spec.legend) {
        const item = document.createElement("li");
        item.textContent = text;
        legend.append(item);
    }
    scene.after(legend);
    const feedback = document.createElement("p");
    feedback.className = "feature-lesson-feedback";
    feedback.setAttribute("aria-live", "off");
    feedback.textContent = "준비 중 · 위 안내에 따라 같은 장면을 비교해 보세요.";
    legend.after(feedback);
    const visual = createLessonVisual(id, root, scene);
    const stats = stage.querySelector<HTMLElement>(".feature-statistics")!;
    const diagnostics = document.createElement("details");
    diagnostics.className = "feature-lesson-diagnostics";
    const summary = document.createElement("summary");
    summary.textContent = "엔진 실행 정보";
    stats.before(diagnostics);
    diagnostics.append(summary, stats);
    let destroyed = false;
    return {
        controlsHost: scene,
        entityIds: spec.roles.map(role => role.entity).filter(Boolean),
        update(sample: LessonSample) {
            if (destroyed)
                return;
            feedback.textContent = visual.update(sample) ?? sample.observation;
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
            intro.remove();
            annotations.remove();
            legend.remove();
            feedback.remove();
            diagnostics.replaceWith(stats);
            scene.replaceWith(canvas);
            delete root.dataset.featureTopic;
        },
    };
}

import type { LessonSample } from "./featureLesson";
type Data = Record<string, unknown>;
const record = (value: unknown): Data => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Data : {};
const num = (value: unknown, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const text = (value: unknown, fallback = "—") => typeof value === "string" || typeof value === "number" ? String(value) : fallback;
/** Small presentation diagrams fed by the existing native/platform observations. */
export function createLessonVisual(id: string, root: HTMLElement, scene: HTMLElement) {
    const element = document.createElement("section");
    element.className = "feature-lesson-visual";
    element.dataset.kind = id;
    const title = document.createElement("h3"), body = document.createElement("div"), note = document.createElement("p");
    element.append(title, body, note);
    const value = (key: string) => root.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-control="${key}"]`)?.value;
    const checked = (key: string) => !!root.querySelector<HTMLInputElement>(`[data-control="${key}"]`)?.checked;
    const cells = (names: string[]) => {
        body.className = "feature-lesson-cells";
        return names.map(name => {
            const cell = document.createElement("div"), label = document.createElement("span"), amount = document.createElement("strong");
            label.textContent = name;
            cell.append(label, amount);
            body.append(cell);
            return { cell, amount };
        });
    };
    let update: (sample: LessonSample) => string | undefined = () => undefined;
    let overlay: SVGSVGElement | undefined;
    if (id === "animation") {
        title.textContent = "원본 4프레임 → 캐릭터 모션";
        const frames = cells(["1번", "2번", "3번", "4번"]);
        frames.forEach(({ cell }, i) => {
            const image = document.createElement("i");
            image.className = "feature-lesson-sprite";
            image.style.backgroundPosition = `${i * 100 / 3}% 0`;
            cell.prepend(image);
        });
        let imagesReady = false;
        update = sample => {
            if (!imagesReady) {
                for (const image of body.querySelectorAll<HTMLElement>("i"))
                    image.style.backgroundImage = `url("${new URL('./playground/robot.png', document.baseURI).href}")`;
                imagesReady = true;
            }
            const state = record(record(sample.state).spriteAnimation);
            frames.forEach(({ cell }, i) => {
                cell.dataset.active = String(i === num(state.frame));
            });
            note.textContent = `현재 클립 ${text(state.clip, "0")} · ${num(state.frame) + 1}번 그림. 이동·대기는 동작에 맞는 클립으로 전환합니다.`;
            return undefined;
        };
    }
    else if (id === "physics") {
        title.textContent = "같은 공·같은 힘에서 달라지는 재질";
        const fields = cells(["적용한 재질", "현재 공의 속력", "충돌 관측"]);
        update = sample => {
            const s = record(record(sample.state).physicsObservation), rubber = value("material") === "rubber";
            fields[0].amount.textContent = rubber ? "고무" : "점토";
            fields[1].amount.textContent = num(s.speed).toFixed(1);
            fields[2].amount.textContent = `${num(s.contacts)}회`;
            note.textContent = "고무는 높은 반발, 점토는 낮은 반발·높은 감쇠를 함께 설정한 비교 재질입니다.";
            return num(s.launches) === 0 ? "아직 공을 던지지 않았습니다. 위에서 같은 힘으로 던지기를 눌러 보세요." : `${rubber ? "고무" : "점토"}로 ${num(s.launches)}회 던짐 · 현재 속력 ${num(s.speed).toFixed(1)} · 벽에 닿은 뒤 움직임을 비교하세요.`;
        };
    }
    else if (id === "navigation") {
        title.textContent = "실제 경로 이동 상태";
        const fields = cells(["이동 상태"]);
        update = sample => {
            const status = text(record(sample.state).navigationStatus, "idle");
            const message = ({ idle: "목적지 선택 대기", moving: "장애물을 피해 이동 중", arrived: "목적지 도착", blocked: "이동 경로가 막힘", cancelled: "이동 취소" } as Record<string, string>)[status] ?? status;
            fields[0].amount.textContent = message;
            note.textContent = root.querySelector('[data-value="destination"]')?.textContent ?? "";
            return note.textContent.includes("없는 목적지") ? note.textContent : message;
        };
    }
    else if (id === "lighting") {
        title.textContent = "같은 표면의 원본 그림과 방향 정보";
        const fields = cells(["원본 색상 PNG", "노멀맵 · 표면 방향"]);
        for (const { cell } of fields) {
            const image = document.createElement("i");
            image.className = "feature-lesson-normal-preview";
            cell.prepend(image);
        }
        let imagesReady = false;
        update = () => {
            if (!imagesReady) {
                fields.forEach(({ cell }, i) => {
                    cell.querySelector<HTMLElement>("i")!.style.backgroundImage = `url("${new URL(`./playground/${i ? 'ball-normal' : 'ball'}.png`, document.baseURI).href}")`;
                });
                imagesReady = true;
            }
            const lit = value("lighting") !== "off", normal = checked("normal");
            fields[1].cell.dataset.active = String(lit && normal);
            fields[0].amount.textContent = "고정된 그림";
            fields[1].amount.textContent = normal ? "사용 중" : "사용 안 함";
            note.textContent = "노멀맵의 색은 표면이 향하는 방향입니다. 이 정보와 광원 위치로 밝은 면을 계산합니다.";
            return !lit ? "조명 끔 · 원본 이미지 색상을 보고 있습니다." : normal ? "노멀맵 사용 · 위·아래 광원을 바꿔 빛을 향한 면이 밝아지는지 보세요." : "노멀맵 끔 · 표면 방향에 따른 입체적인 밝기 변화와 비교하세요.";
        };
    }
    else if (id === "postprocess") {
        title.textContent = "같은 장면의 최종 화면 효과";
        const fields = cells(["원본", "Bloom", "CRT"]);
        update = () => {
            const mode = value("effect");
            fields.forEach(({ cell, amount }, i) => {
                const active = mode === ["clean", "bloom", "crt"][i];
                cell.dataset.active = String(active);
                amount.textContent = active ? "선택됨" : "";
            });
            note.textContent = "Bloom은 밝은 부분의 빛을 번지게 하고 CRT는 화면 곡률·주사선을 추가합니다.";
            return mode === "clean" ? "원본 화면 · 객체의 위치와 수는 유지됩니다." : mode === "bloom" ? "Bloom 적용 · 밝은 에너지와 패널 가장자리의 번짐을 보세요." : "CRT 적용 · 패널 외곽의 굽음과 스캔라인을 보세요.";
        };
    }
    else if (id === "camera") {
        title.textContent = "전체 월드와 현재 화면";
        body.innerHTML = `<svg viewBox="0 0 640 384" aria-label="전체 월드 안의 카메라 영역"><defs><clipPath id="lesson-camera-clip"><rect width="640" height="384"/></clipPath></defs><rect width="640" height="384" class="lesson-world"/><path d="M320 0V384M0 192H640" class="lesson-axis"/><rect class="lesson-camera-window" clip-path="url(#lesson-camera-clip)"/><circle r="10" class="lesson-camera-actor"/></svg>`;
        update = sample => {
            const view = sample.viewport, actor = sample.poses.robot;
            if (view) {
                const window = body.querySelector(".lesson-camera-window")!;
                for (const [key, amount] of Object.entries({ x: view.worldMinX, y: view.worldMinY, width: view.cssWidth / view.zoom, height: view.cssHeight / view.zoom }))
                    window.setAttribute(key, String(amount));
            }
            const marker = body.querySelector("circle")!;
            marker.setAttribute("cx", String(actor?.x ?? 128));
            marker.setAttribute("cy", String(actor?.y ?? 192));
            note.textContent = "테두리가 작아질수록 월드의 좁은 부분을 크게 봅니다. 점은 캐릭터의 실제 위치입니다.";
            return undefined;
        };
    }
    else if (id === "layers") {
        title.textContent = "현재 앞 → 뒤 그리기 순서";
        update = () => {
            const order = value("order"), robot = order === "front" ? 2 : order === "middle" ? 0 : -2;
            body.replaceChildren();
            for (const [name, layer] of [["로봇", robot], ["공", 1], ["앞쪽 패널", -1], ["배경", -100]].sort((a, b) => Number(b[1]) - Number(a[1]))) {
                const item = document.createElement("span");
                item.textContent = `${name} (${layer})`;
                body.append(item);
            }
            body.className = "feature-lesson-order";
            note.textContent = "객체를 움직이는 대신 겹치는 부분의 앞뒤만 바뀝니다.";
            return undefined;
        };
    }
    else if (id === "particles") {
        title.textContent = "효과를 구분하는 포인트";
        const fields = cells(["불꽃", "먼지", "잔상"]);
        ["짧고 빠른 수축", "느린 팽창·흐려짐", "지나간 경로"].forEach((label, index) => { fields[index].amount.textContent = label; });
        update = sample => {
            const s = record(record(sample.state).particles);
            fields.forEach(({ cell }, index) => { cell.dataset.active = String(s.comparing ? index < 2 : s.selected === ["hit-spark", "dust-loop", "motion-trail"][index]); });
            note.textContent = s.comparing ? "기본값 나란히 비교 · 불꽃은 짧게 반복하고, 먼지는 연속으로 커지며 사라집니다." : text(record(s.profile).description, "효과를 골라 방출하세요.");
            return note.textContent;
        };
    }
    else if (id === "input") {
        title.textContent = "게임으로 전달된 방향 입력";
        const keys = cells(["W / ↑", "A / ←", "S / ↓", "D / →"]);
        update = sample => {
            keys.forEach(({ cell, amount }, i) => {
                const active = !!sample.input?.[(["w", "a", "s", "d"] as const)[i]];
                cell.dataset.active = String(active);
                amount.textContent = active ? "입력 중" : "—";
            });
            const menu = !!root.querySelector<HTMLDialogElement>(".feature-input-menu")?.open;
            note.textContent = menu ? "메뉴에 글자를 입력하는 중입니다. 게임 방향 입력은 모두 중립이어야 합니다." : "캔버스를 누르고 이동하세요. 키보드·게임패드·조이스틱을 같은 입력으로 합칩니다.";
            return menu ? "메뉴 입력 중 · 캐릭터 이동 입력 차단" : undefined;
        };
    }
    else if (id === "scenes") {
        title.textContent = "방을 바꿔도 가져갈 값";
        const fields = cells(["현재 공간", "이 방의 카운터", "여행 전체 카운터"]);
        update = sample => {
            const s = record(record(sample.state).transition);
            fields[0].amount.textContent = s.room === "other" ? "B 공간" : "A 공간";
            fields[1].amount.textContent = text(s.local, "0");
            fields[2].amount.textContent = text(s.total, "0");
            fields[0].cell.dataset.active = "true";
            note.textContent = s.phase !== "idle" ? "암전 중 · 새 공간을 적용한 뒤 다시 밝아집니다." : "다음 공간으로 가면 이 방의 값은 0, 여행 전체 값은 유지됩니다.";
            return undefined;
        };
    }
    else if (id === "interaction") {
        title.textContent = "접근 → 스위치 → 문 사용";
        const fields = cells(["문 사용 조건", "문 사용 횟수", "구역 진입 / 이탈"]);
        update = sample => {
            const s = record(record(sample.state).interaction);
            fields[0].amount.textContent = s.unlocked ? "해제됨" : "잠김";
            fields[0].cell.dataset.active = String(!!s.unlocked);
            fields[1].amount.textContent = text(s.uses, "0");
            fields[2].amount.textContent = `${text(s.enter, "0")} / ${text(s.exit, "0")}`;
            note.textContent = "문 표식의 사용 조건과 통과 가능한 감지 구역을 구분하세요. 실제 벽 개폐는 타일맵 예제에서 확인합니다.";
            return undefined;
        };
    }
    else if (id === "save-load") {
        title.textContent = "수집 → 저장 → 초기화 → 불러오기";
        const fields = cells(["현재 수집 진행", "최근 저장 작업"]);
        update = sample => {
            const s = record(record(sample.state).save);
            fields[0].amount.textContent = `${text(s.collected, "0")} / 1`;
            fields[1].amount.textContent = ({ save: "저장 완료", load: "복원 완료", "delete-save": "슬롯 삭제", none: "작업 대기" } as Record<string, string>)[text(s.lastOperation)] ?? text(s.lastOperation);
            note.textContent = s.error ? text(s.error) : "실험 초기화는 저장 슬롯을 남깁니다. 저장 삭제는 이 예제의 슬롯만 지웁니다.";
            return undefined;
        };
    }
    else if (id === "projectiles") {
        title.textContent = "벽에서 일어나는 세 가지 결과";
        const fields = cells(["일반 · 제거", "벽 관통 · 통과", "반사 · 되돌아옴"]);
        update = sample => {
            const s = record(record(sample.state).projectile);
            const mode = value("projectile");
            fields.forEach(({ cell, amount }, i) => {
                const active = mode === (["despawn", "passThrough", "bounce"])[i];
                cell.dataset.active = String(active);
                amount.textContent = active ? "선택됨" : "";
            });
            note.textContent = `발사 ${text(s.shots, "0")}회 · 한 발씩 쏘아 중앙 벽 전후의 움직임을 보세요.`;
            return undefined;
        };
    }
    else if (id === "cutscene") {
        title.textContent = "실제 연출의 진행 순서";
        const fields = cells(["로봇 안내", "카메라 이동", "효과음", "표식 안내", "카메라 이동", "마무리"]);
        update = sample => {
            const s = record(record(sample.state).cutscene), index = num(s.commandIndex);
            fields.forEach(({ cell, amount }, i) => {
                cell.dataset.active = String(!!s.running && i === index);
                amount.textContent = i < index ? "완료" : i === index && s.running ? "진행 중" : "";
            });
            note.textContent = text(s.subtitle, "재생을 누르면 실제 카메라·자막·소리를 순서대로 실행합니다.");
            return s.loading ? "소리 준비 중 · 준비가 끝나면 연출을 시작합니다." : undefined;
        };
    }
    else if (id === "asset-loading") {
        element.classList.add("feature-lesson-dashboard");
        title.textContent = "게임 시작 전에 필요한 3개 에셋";
        const names = document.createElement("p");
        names.textContent = "바닥 이미지 · 캐릭터 시트 · 애니메이션 씬";
        title.after(names);
        const fields = cells(["준비된 항목", "네트워크 요청", "캐시 적중"]);
        const progress = document.createElement("progress");
        progress.max = 3;
        progress.setAttribute("aria-label", "화면의 에셋 준비 진행");
        body.after(progress);
        update = sample => {
            const s = record(record(sample.state).loading);
            fields[0].amount.textContent = `${text(s.loaded, "0")} / 3`;
            fields[1].amount.textContent = `${text(s.requests, "0")}회`;
            fields[2].amount.textContent = `${text(s.cached, "0")}개`;
            progress.value = num(s.loaded);
            element.dataset.state = text(s.state, "idle");
            note.textContent = ({ idle: "불러오기를 눌러 시작하세요. 캐시는 새로고침하면 비워집니다.", loading: "에셋을 준비하고 있습니다. 취소할 수 있도록 요청마다 300ms 지연합니다.", complete: "준비 완료. 다시 불러와 네트워크 요청이 캐시 적중으로 바뀌는지 보세요.", cancelled: "취소했습니다. 완료된 캐시는 남기고 다시 시도할 수 있습니다.", error: "실패를 주입했습니다. 불러오기를 눌러 정상 복구하세요." } as Record<string, string>)[text(s.state)] ?? text(s.state);
            return note.textContent;
        };
    }
    else if (id === "streaming") {
        element.classList.add("feature-lesson-dashboard");
        title.textContent = "세 구역 중 지금 필요한 곳 준비하기";
        const fields = cells(["1 · 왼쪽 구역", "2 · 가운데 구역", "3 · 오른쪽 구역"]);
        update = sample => {
            const s = record(record(sample.state).streaming), visible = num(s.visible, -1), selected = num(s.selected, -1);
            fields.forEach(({ cell, amount }, i) => {
                cell.dataset.active = String(i === visible);
                cell.dataset.pending = String(!!s.pending && i === selected);
                amount.textContent = i === visible ? "표시 중" : s.pending && i === selected ? "준비 중" : "표시 안 함";
            });
            note.textContent = `공통 바닥 유지 · 해제한 전용 텍스처 ${text(s.releases, "0")}개`;
            return s.pending ? `${selected + 1}번 구역 준비 중${visible >= 0 ? ` · 화면은 ${visible + 1}번 구역 유지` : ""}` : visible >= 0 ? `${visible + 1}번 구역 표시 중 · 다른 구역을 골라 교체·해제를 비교하세요.` : "위에서 구역을 선택하세요. 준비가 끝난 구역만 실제 씬에 적용합니다.";
        };
    }
    else if (id === "hd2d-movement") {
        title.textContent = "캐릭터가 서 있는 높이";
        const fields = cells(["현재 층", "지면 위 높이", "발판 탑승"]);
        update = sample => {
            const s = record(sample.state), actor = record(record(s.poses).actor), span = record(actor.heightSpan);
            fields[0].amount.textContent = `${num(span.floorId)}층`;
            fields[1].amount.textContent = num(span.elevation).toFixed(1);
            fields[2].amount.textContent = num(record(s.platforms).carriedBodies) > 0 ? "탑승 중" : "지형 위";
            note.textContent = "경사로는 층을 연결하고, 움직이는 발판은 타고 있는 캐릭터를 함께 옮깁니다.";
            return undefined;
        };
    }
    else if (id === "ai-combat") {
        title.textContent = "플레이어 체력과 적의 실제 공격";
        const fields = cells(["현재 체력", "발사 / 적중"]);
        update = sample => {
            const s = record(sample.state), combat = record(s.combat);
            fields[0].amount.textContent = text(s.health, "0");
            fields[1].amount.textContent = `${num(combat.spawned)} / ${num(combat.hits)}`;
            note.textContent = num(s.health) === 0 ? "전투 종료 · 실험 초기화로 다시 비교하세요." : "추적은 공격하지 않습니다. 공격 모드를 바꿔 피해·탄환을 비교하세요.";
            return undefined;
        };
    }
    else if (id === "attachments") {
        title.textContent = "부모 좌표계에 연결된 소품";
        const fields = cells(["부모 · 수레", "자식 · 등불 / 상자"]);
        update = sample => {
            const s = record(sample.state);
            fields[0].amount.textContent = "이동·회전";
            fields[1].amount.textContent = s.linked ? "부모를 따라감" : "월드 위치 유지";
            fields[1].cell.dataset.active = String(!!s.linked);
            note.textContent = s.linked ? "연결됨 · 부모를 움직이면 자식도 함께 변합니다." : "연결 해제 · 부모만 움직여 마지막 위치에 남는 자식을 비교하세요.";
            return note.textContent;
        };
    }
    else if (id === "hd2d-shadow-proxy") {
        title.textContent = "같은 그림 · 다른 그림자 원본";
        const fields = cells(["그림자 원본", "고도 / 캐릭터 높이", "부피 모델 표시"]);
        update = sample => {
            const s=record(sample.state),shadow=record(s.shadowComparison);
            fields[0].amount.textContent=shadow.mode==="proxy"?"월드 부피":shadow.mode==="billboard"?"표시 평면":"OFF";
            fields[1].amount.textContent=`${num(shadow.elevation)}° / ${num(shadow.height)}`;
            fields[2].amount.textContent=`${num(s.visibleModels)} / ${num(s.models)}`;
            note.textContent="카메라만 돌렸을 때 같은 지면의 그림자를 비교하세요. 부피는 프레임마다 변하는 정밀 실루엣이 아닙니다.";
            return note.textContent;
        };
    }
    else if (id === "hd2d-environment") {
        title.textContent = "같은 장면의 표현 설정";
        const fields = cells(["공간 조명", "그림자", "거리 안개"]);
        update = () => {
            ["environment-lighting", "environment-shadows", "environment-fog"].forEach((key, i) => {
                const active = checked(key);
                fields[i].cell.dataset.active = String(active);
                fields[i].amount.textContent = active ? "켬" : "끔";
            });
            note.textContent = "객체를 바꾸지 않고 밝은 면·가려진 면·먼 표면을 비교합니다.";
            return undefined;
        };
    }
    else if (id === "audio") {
        title.textContent = "듣는 위치 ↔ 소리가 나는 위치";
        body.innerHTML = '<svg viewBox="0 0 100 20" aria-label="좌우 음원 위치"><path d="M8 10H92" class="lesson-axis"/><circle cx="50" cy="10" r="3" class="lesson-listener"/><circle cy="10" r="3" class="lesson-source"/></svg>';
        update = sample => {
            body.querySelector('.lesson-source')!.setAttribute('cx', String(50 + Number(value('pan') ?? 0) / 224 * 42));
            note.textContent = sample.observation;
            return undefined;
        };
        overlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        overlay.classList.add('feature-audio-connector');
        overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = '<line/>';
        scene.append(overlay);
        const audioUpdate = update;
        update = sample => {
            const result = audioUpdate(sample), listener = sample.poses.robot, source = sample.poses.source, a = listener && sample.project?.(listener), b = source && sample.project?.(source);
            overlay!.setAttribute('viewBox', `0 0 ${scene.clientWidth} ${scene.clientHeight}`);
            overlay!.style.display = a && b ? '' : 'none';
            if (a && b)
                for (const [key, amount] of Object.entries({ x1: a.x, y1: a.y, x2: b.x, y2: b.y }))
                    overlay!.querySelector('line')!.setAttribute(key, String(amount));
            return result;
        };
    }
    else {
        return { update: (_sample: LessonSample): string | undefined => undefined, destroy() {
            } };
    }
    if (element.classList.contains("feature-lesson-dashboard"))
        scene.append(element);
    else
        scene.after(element);
    return { update, destroy() {
            element.remove();
            overlay?.remove();
        } };
}

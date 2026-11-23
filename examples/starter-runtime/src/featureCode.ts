import { createExampleCode, exampleDocsUrl, type ExampleMoreTab } from "../../shared/exampleCode";

const LAB_DIR = "examples/starter-runtime/";

/** The lab's "더 보기": the description, the experiment's scene file, its public API, the lab sources and
 * the live engine numbers. */
export function createFeatureCode(options: { id: string; api: string; sources: readonly string[]; about: HTMLElement; engine: HTMLElement }) {
  const leading: ExampleMoreTab[] = [{ key: "about", label: "설명", content: options.about }];
  const trailing: ExampleMoreTab[] = [{ key: "engine", label: "엔진 수치", content: options.engine }];
  return createExampleCode({
    leading, trailing,
    data: { label: "씬 JSON", path: `${LAB_DIR}public/features/${options.id}.json`, url: `./features/${options.id}.json` },
    api: options.api,
    apiNote: "이 실험이 쓰는 공개 API입니다. 인자와 반환값은 API 문서에서 확인하세요.",
    sources: options.sources.map(source => `${LAB_DIR}${source}`),
    sourcesNote: "설정을 엔진에 적용하는 실험실 코드와, 처음 불러오는 씬 파일입니다.",
    docsUrl: exampleDocsUrl("starter-runtime/"),
  });
}

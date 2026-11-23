import { createExampleCode, exampleDocsUrl } from "../../shared/exampleCode";

const LAB_DIR = "examples/starter-runtime/";

/** The lab's code view: the experiment's scene file, its public API and the lab sources. */
export function createFeatureCode(options: { id: string; api: string; sources: readonly string[] }) {
  return createExampleCode({
    data: { label: "씬 JSON", path: `${LAB_DIR}public/features/${options.id}.json`, url: `./features/${options.id}.json` },
    api: options.api,
    apiNote: "이 실험이 쓰는 공개 API입니다. 인자와 반환값은 API 문서에서 확인하세요.",
    sources: options.sources.map(source => `${LAB_DIR}${source}`),
    sourcesNote: "설정을 엔진에 적용하는 실험실 코드와, 처음 불러오는 씬 파일입니다.",
    docsUrl: exampleDocsUrl("starter-runtime/"),
  });
}

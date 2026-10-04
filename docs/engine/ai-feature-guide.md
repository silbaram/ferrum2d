# AI 게임 개발 기능 안내

AI가 게임 요구사항을 Ferrum2D의 기존 기능과 연결하도록 만든 진입 문서다.
게임 프로젝트에서는 **`.agents/harness/ferrum-feature-guide.md`를 먼저 읽는다.**
이 파일은 기능별 목적, 공개 API, 사용 조건, 상세 reference와 검증 절차를 제공한다.

전체 기능 설명의 canonical 원본은
[배포용 기능 안내서](https://github.com/silbaram/ferrum2d/blob/main/packages/agents/templates/shared/.agents/harness/ferrum-feature-guide.md)다.
내용을 이 문서나 도구별 skill에 복제하지 않는다. 저장소 checkout에서는
`packages/agents/templates/shared/.agents/harness/ferrum-feature-guide.md`를 읽는다.

## 읽는 순서

1. `package.json`, 설치된 `@ferrum2d/ferrum-web/package.json`, `FERRUM_INSTALL.md`로 실제 버전과 출처를 확인한다.
2. 기능 안내서에서 요구사항을 찾는다. 캐릭터·물리·행동, 입력·카메라·2.5D·그림자,
   에셋·오디오·대화·저장·성능 검증 순으로 묶여 있다.
3. 안내된 public subpath와 설치된 `.d.ts`에서 실제 함수/옵션을 확인한다.
4. 설치 버전의 Git tag에 고정된 문서로 동작과 제약을 확인하고 게임 설정/코드에 적용한다.
5. 프로젝트에 정의된 검증 명령과 브라우저 조작으로 확인한다.

기능 안내서의 현재 기능 기준은 **runtime `0.1.0-beta.7`**다. 안내서 자체의 배포와 엔진 기능의
도입 버전은 별개다. 위 canonical 링크는 개발 중인 `main`이며 설치 버전의 기능 증거가 아니다.
안내서는 **agents `0.1.0-beta.6`부터 포함**된다. beta.6의 runtime API는 beta.5와 같으며,
기존 beta.5 agents tarball에는 이 안내서가 없다. 이전 지침을 사용하는 프로젝트는
안내서와 연결 지침을 비교·병합하고 설치된 API와 대조한다.

새 agents 패키지 설치 시 `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`와 공통 harness가 이 안내서를
참조한다. 기존 프로젝트는 재설치만으로 구형 지침이 교체되지 않으므로 새 파일과 기존 지침을
비교·병합한다. 초기 설치 요청만으로 게임 파일·예제·서버를 추가하지 않는다.

## API와 상세 reference

- [Public API](public-api.md): 허용 import 경로, stable/preview/compatibility 구분
- [Data Scene native actor](data-scene-native-runtime.md): 이미지·물리·가림·카메라 연결
- [애니메이션·지면 투영·그림자](data-scene-presentation.md): clip/frame/방향, 2.5D, alpha 그림자
- [입력 액션](input-actions.md): 키 바인딩, 눌림/해제, UI에서 게임 입력 차단
- [Data Scene Authoring](data-scene-authoring.md), [Runtime 확장](runtime-extensibility.md): 씬과 행동 구성
- [Physics Spec](physics-spec.md): 물리 authoring 범위
- [AI 설치 지침](ai-agent-install.md): 게임 코드 없는 초기 설정

## 유지보수 기준

공개 게임 개발 기능을 추가/변경할 때는 canonical 안내서에서 해당 요구사항 행, 최소 버전,
제약과 reference를 확인한다. 계획 중인 기능은 지원 목록에 넣지 않는다. 함수명은 실제 public
export, 메서드는 facade 타입과 대조한다. `main`의 API를 과거 릴리즈에 소급해 약속하지 않는다.

`pnpm package:check:agents`는 안내서가 tarball과 설치 결과에 포함되고 진입 지침에서 참조되는지
검사한다. `pnpm package:consumer-smoke -- --skip-build --skip-package-check --templates minimal`은
패키지로 설치한 실제 게임 프로젝트에서도 같은 안내서를 받을 수 있는지 확인한다.


beta.7의 Data Scene gameplay/navigation, primary actor 목적지 이동·애니메이션 연결과 opt-in 진행 저장·복원은 canonical 안내서의 Data Scene 절에서
설명한다. 최소 버전과 설치 타입을 확인하며 primitive 설정 성공만으로 실행 지원을 판정하지 않는다.

import {
  DialogueSession,
  LocalizationBundle,
  QuestLog,
  captureDialogueQuestState,
  deriveTileOccludersFromTilemapGrid,
  dialogueNodeToUiOverlayState,
  equal,
  layoutLocalizedText,
  loadFontLoadingPolicy,
  localizationLocaleChain,
  normalizeLightingScene,
  resolveDialogueGraph,
  resolveFontLoadingPolicy,
  resolveLocalizationDocument,
  resolveQuestDocument,
  restoreDialogueQuestState,
  test,
} from "./publicApiTypes.shared.js";

import type {
  BitmapFontPolicySpec,
  DialogueChoiceResult,
  DialogueChoiceSpec,
  DialogueGraphSpec,
  DialogueNodeSpec,
  DialogueQuestStateSnapshot,
  DialogueSessionSnapshot,
  DialogueUiOptions,
  FontDisplayPolicy,
  FontFaceSetLike,
  FontLoadingPolicySpec,
  LoadFontPolicyResult,
  LocalizationDocumentSpec,
  LocalizationLocaleSpec,
  LocalizationPlaceholderValue,
  LocalizationStringEntrySpec,
  LocalizationStringSpec,
  LocalizeOptions,
  LocalizedTextResult,
  MissingLocalizationBehavior,
  PublicApi,
  QuestDocumentSpec,
  QuestLogSnapshot,
  QuestObjectiveSpec,
  QuestProgressSnapshot,
  QuestSpec,
  QuestStageSpec,
  QuestStatus,
  QuestUpdateAction,
  QuestUpdateSpec,
  ResolveDialogueQuestOptions,
  ResolveLocalizationOptions,
  ResolvedBitmapFontPolicy,
  ResolvedDialogueChoice,
  ResolvedDialogueGraph,
  ResolvedDialogueNode,
  ResolvedFontLoadingPolicy,
  ResolvedLocalizationDocument,
  ResolvedLocalizationLocale,
  ResolvedLocalizationString,
  ResolvedQuest,
  ResolvedQuestDocument,
  ResolvedQuestObjective,
  ResolvedQuestStage,
  ResolvedQuestUpdate,
  ResolvedWebFontPolicy,
  RestoreDialogueQuestStateOptions,
  SpriteMaterialProvider,
  TextDirection,
  TextLayoutLine,
  TextLayoutOptions,
  TextLayoutResult,
  UiOverlayState,
  WebFontPolicySpec,
} from "./publicApiTypes.shared.js";

test("public API localization, font, dialogue, and quest types", () => {
  const textDirection: TextDirection = "ltr";
  const localizationPlaceholderValue: LocalizationPlaceholderValue = "Ferrum";
  const localizationStringEntry: LocalizationStringEntrySpec = {
    text: "Hello, {name}",
    description: "Greeting",
  };
  const localizationString: LocalizationStringSpec = localizationStringEntry;
  const localizationLocale: LocalizationLocaleSpec = {
    direction: textDirection,
    strings: {
      greeting: localizationString,
      start: "Start",
    },
  };
  const localizationDocumentSpec: LocalizationDocumentSpec = {
    defaultLocale: "en",
    fallbackLocale: "en",
    locales: {
      en: localizationLocale,
      ko: { strings: { start: "시작" } },
    },
  };
  const localizationOptions: ResolveLocalizationOptions = { path: "localization" };
  const publicResolveLocalizationDocument: PublicApi["resolveLocalizationDocument"] =
    resolveLocalizationDocument;
  const publicLocalizationBundle: PublicApi["LocalizationBundle"] = LocalizationBundle;
  const publicLocalizationLocaleChain: PublicApi["localizationLocaleChain"] = localizationLocaleChain;
  const resolvedLocalization: ResolvedLocalizationDocument =
    publicResolveLocalizationDocument(localizationDocumentSpec, localizationOptions);
  const resolvedLocalizationLocale: ResolvedLocalizationLocale = resolvedLocalization.locales.en;
  const resolvedLocalizationString: ResolvedLocalizationString = resolvedLocalizationLocale.strings.greeting;
  const localizationBundle = publicLocalizationBundle.create(resolvedLocalization, "ko-KR");
  const missingLocalizationBehavior: MissingLocalizationBehavior = "fallback";
  const localizeOptions: LocalizeOptions = {
    values: { name: localizationPlaceholderValue },
    missing: missingLocalizationBehavior,
  };
  const localizedText: LocalizedTextResult = localizationBundle.localize("greeting", localizeOptions);
  const textLayoutOptions: TextLayoutOptions = { maxCharsPerLine: 12, maxLines: 2, overflow: "ellipsis" };
  const publicLayoutLocalizedText: PublicApi["layoutLocalizedText"] = layoutLocalizedText;
  const textLayout: TextLayoutResult = publicLayoutLocalizedText(localizedText.text, textLayoutOptions);
  const textLayoutLine: TextLayoutLine = textLayout.lines[0];
  const fontDisplayPolicy: FontDisplayPolicy = "swap";
  const webFontPolicySpec: WebFontPolicySpec = {
    family: "Ferrum UI",
    sources: ["/fonts/ferrum.woff2"],
    display: fontDisplayPolicy,
  };
  const bitmapFontPolicySpec: BitmapFontPolicySpec = {
    image: "/fonts/pixel.png",
    data: "/fonts/pixel.json",
  };
  const fontLoadingPolicySpec: FontLoadingPolicySpec = {
    defaultFamily: "Ferrum UI",
    webFonts: { ui: webFontPolicySpec },
    bitmapFonts: { pixel: bitmapFontPolicySpec },
  };
  const publicResolveFontLoadingPolicy: PublicApi["resolveFontLoadingPolicy"] = resolveFontLoadingPolicy;
  const publicLoadFontLoadingPolicy: PublicApi["loadFontLoadingPolicy"] = loadFontLoadingPolicy;
  const fontPolicy: ResolvedFontLoadingPolicy = publicResolveFontLoadingPolicy(fontLoadingPolicySpec);
  const resolvedWebFont: ResolvedWebFontPolicy = fontPolicy.webFonts[0];
  const resolvedBitmapFont: ResolvedBitmapFontPolicy = fontPolicy.bitmapFonts[0];
  const fontFaceSet: FontFaceSetLike = { load: async () => [] };
  const fontLoadPromise: Promise<LoadFontPolicyResult> = publicLoadFontLoadingPolicy(fontPolicy, fontFaceSet);
  void fontLoadPromise;
  const questStatus: QuestStatus = "active";
  const questUpdateAction: QuestUpdateAction = "start";
  const questObjectiveSpec: QuestObjectiveSpec = { text: "Talk" };
  const questStageSpec: QuestStageSpec = {
    title: "Intro",
    objectives: { talk: questObjectiveSpec },
  };
  const questSpec: QuestSpec = { title: "Tutorial", stages: { intro: questStageSpec } };
  const questDocumentSpec: QuestDocumentSpec = { quests: { tutorial: questSpec } };
  const questUpdateSpec: QuestUpdateSpec = { quest: "tutorial", action: questUpdateAction, stage: "intro" };
  const dialogueChoiceSpec: DialogueChoiceSpec = {
    id: "accept",
    label: "Accept",
    to: "done",
    questUpdates: [questUpdateSpec],
  };
  const dialogueNodeSpec: DialogueNodeSpec = {
    speaker: "Guide",
    text: "Ready?",
    choices: [dialogueChoiceSpec],
  };
  const dialogueGraphSpec: DialogueGraphSpec = {
    initialNode: "start",
    nodes: {
      start: dialogueNodeSpec,
      done: { text: "Done", end: true },
    },
  };
  const dialogueQuestOptions: ResolveDialogueQuestOptions = { path: "dialogue" };
  const publicResolveQuestDocument: PublicApi["resolveQuestDocument"] = resolveQuestDocument;
  const publicResolveDialogueGraph: PublicApi["resolveDialogueGraph"] = resolveDialogueGraph;
  const publicQuestLog: PublicApi["QuestLog"] = QuestLog;
  const publicDialogueSession: PublicApi["DialogueSession"] = DialogueSession;
  const publicDialogueNodeToUiOverlayState: PublicApi["dialogueNodeToUiOverlayState"] =
    dialogueNodeToUiOverlayState;
  const publicCaptureDialogueQuestState: PublicApi["captureDialogueQuestState"] = captureDialogueQuestState;
  const publicRestoreDialogueQuestState: PublicApi["restoreDialogueQuestState"] = restoreDialogueQuestState;
  const resolvedQuestDocument: ResolvedQuestDocument =
    publicResolveQuestDocument(questDocumentSpec, dialogueQuestOptions);
  const resolvedQuest: ResolvedQuest = resolvedQuestDocument.quests.tutorial;
  const resolvedQuestStage: ResolvedQuestStage = resolvedQuest.stages[0];
  const resolvedQuestObjective: ResolvedQuestObjective = resolvedQuestStage.objectives[0];
  const resolvedDialogueGraph: ResolvedDialogueGraph =
    publicResolveDialogueGraph(dialogueGraphSpec, dialogueQuestOptions);
  const resolvedDialogueNode: ResolvedDialogueNode = resolvedDialogueGraph.nodes.start;
  const resolvedDialogueChoice: ResolvedDialogueChoice = resolvedDialogueNode.choices[0];
  const resolvedQuestUpdate: ResolvedQuestUpdate = resolvedDialogueChoice.questUpdates[0];
  const questLog = publicQuestLog.create(resolvedQuestDocument);
  const questProgress: QuestProgressSnapshot = questLog.apply(questUpdateSpec);
  const questLogSnapshot: QuestLogSnapshot = questLog.snapshot();
  const dialogueSession = publicDialogueSession.create(resolvedDialogueGraph, questLog);
  const dialogueChoiceResult: DialogueChoiceResult = dialogueSession.choose("accept");
  const dialogueSessionSnapshot: DialogueSessionSnapshot = dialogueSession.snapshot();
  const dialogueUiOptions: DialogueUiOptions = { title: "Talk" };
  const dialogueUiState: UiOverlayState = publicDialogueNodeToUiOverlayState(dialogueSession, dialogueUiOptions);
  const dialogueQuestSnapshot: DialogueQuestStateSnapshot =
    publicCaptureDialogueQuestState(dialogueSession, questLog);
  const restoreDialogueQuestOptions: RestoreDialogueQuestStateOptions = {
    dialogue: dialogueSession,
    questLog,
  };
  publicRestoreDialogueQuestState(dialogueQuestSnapshot, restoreDialogueQuestOptions);
  const spriteMaterialProvider: SpriteMaterialProvider = (frame) => (frame.gameState > 0 ? "flash" : false);
  const publicNormalizeLightingScene: PublicApi["normalizeLightingScene"] = normalizeLightingScene;
  const publicDeriveTileOccludersFromTilemapGrid: PublicApi["deriveTileOccludersFromTilemapGrid"] =
    deriveTileOccludersFromTilemapGrid;
  equal(publicLocalizationLocaleChain(resolvedLocalization, "ko-KR")[0], "ko");
  equal(resolvedLocalizationString.text, "Hello, {name}");
  equal(localizationBundle.t("start"), "시작");
  equal(localizedText.text, "Hello, Ferrum");
  equal(textLayoutLine.text.length > 0, true);
  equal(fontPolicy.cssFontFamily.includes("Ferrum UI"), true);
  equal(resolvedWebFont.display, "swap");
  equal(resolvedBitmapFont.image, "/fonts/pixel.png");
  equal(questStatus, "active");
  equal(resolvedQuestObjective.text, "Talk");
  equal(resolvedQuestUpdate.quest, "tutorial");
  equal(questProgress.stage, "intro");
  equal(questLogSnapshot.quests[0].id, "tutorial");
  equal(dialogueChoiceResult.ended, true);
  equal(dialogueSessionSnapshot.nodeId, "done");
  equal(dialogueUiState.dialog?.title, "Talk");
  equal(dialogueQuestSnapshot.format, "ferrum-dialogue-quest-state");
});

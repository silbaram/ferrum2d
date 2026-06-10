import { resolveCutsceneSequenceSpec } from "./cutsceneSequence.js";
import { resolveDialogueGraph } from "./dialogueQuest.js";
import { resolveLocalizationDocument } from "./localization.js";
import { gameSpecError, optionalObject } from "./gameSpecValidation.js";
import type {
  ResolvedShooterContentSpec,
  ShooterContentSpec,
} from "./gameSpecTypes.js";
import type {
  CutsceneSequenceSpec,
  ResolvedCutsceneDialogueCommand,
  ResolvedCutsceneSequenceCommand,
  ResolvedCutsceneSequenceSpec,
} from "./cutsceneSequence.js";
import type { DialogueGraphSpec, ResolvedDialogueGraph } from "./dialogueQuest.js";
import type {
  FerrumRuntimeCutsceneDialogueOptions,
  FerrumRuntimeCutsceneOptions,
  FerrumRuntimeDialogueOptions,
  FerrumRuntimeLocalizationOptions,
  FerrumRuntimeOptions,
} from "./createFerrumRuntime.js";

export type ShooterContentRuntimeOptionSet = Partial<Pick<
  FerrumRuntimeOptions,
  "localization" | "dialogue" | "cutscene"
>>;

export interface ShooterContentRuntimeOptions {
  locale?: string;
  localization?: boolean;
  dialogueGraphId?: string | false;
  dialogue?: false | Omit<FerrumRuntimeDialogueOptions, "graph">;
  cutsceneId?: string | false;
  cutscene?: false | Omit<FerrumRuntimeCutsceneOptions, "sequence">;
  cutsceneDialogue?: false | FerrumRuntimeCutsceneDialogueOptions;
  hydrateCutsceneDialogue?: boolean;
}

export interface ShooterContentRuntimeSelection {
  localization: boolean;
  dialogueGraphId?: string;
  cutsceneId?: string;
}

export function shooterContent(value: unknown, path: string): ResolvedShooterContentSpec {
  const content = optionalObject(value, path) as ShooterContentSpec;
  const dialogue = optionalObject(content.dialogue, `${path}.dialogue`);

  return {
    ...(content.localization === undefined
      ? {}
      : {
          localization: resolveLocalizationDocument(content.localization, {
            path: `${path}.localization`,
          }),
        }),
    dialogueGraphs: dialogueGraphMap(dialogue.graphs, `${path}.dialogue.graphs`),
    cutscenes: cutsceneSequenceMap(content.cutscenes, `${path}.cutscenes`),
  };
}

export function resolveShooterContentRuntimeSelection(
  content: ResolvedShooterContentSpec,
  options: ShooterContentRuntimeOptions = {},
): ShooterContentRuntimeSelection {
  const cutsceneId = selectContentId(
    content.cutscenes,
    options.cutscene === false ? false : options.cutsceneId,
    "content.cutscenes",
  );
  const dialogueGraphId = selectContentId(
    content.dialogueGraphs,
    options.dialogue === false
      ? false
      : options.dialogueGraphId === undefined && cutsceneId !== undefined
        ? false
        : options.dialogueGraphId,
    "content.dialogue.graphs",
  );
  return {
    localization: options.localization !== false && content.localization !== undefined,
    ...(dialogueGraphId === undefined ? {} : { dialogueGraphId }),
    ...(cutsceneId === undefined ? {} : { cutsceneId }),
  };
}

export function createShooterContentRuntimeOptions(
  content: ResolvedShooterContentSpec,
  options: ShooterContentRuntimeOptions = {},
): ShooterContentRuntimeOptionSet {
  const selection = resolveShooterContentRuntimeSelection(content, options);
  const runtimeOptions: ShooterContentRuntimeOptionSet = {};

  if (selection.localization && content.localization !== undefined) {
    runtimeOptions.localization = {
      document: content.localization,
      ...(options.locale === undefined ? {} : { locale: options.locale }),
    } satisfies FerrumRuntimeLocalizationOptions;
  }

  if (selection.dialogueGraphId !== undefined) {
    runtimeOptions.dialogue = {
      graph: content.dialogueGraphs[selection.dialogueGraphId],
      ...(options.dialogue === undefined ? {} : options.dialogue),
    };
  }

  if (selection.cutsceneId !== undefined) {
    const sequence = options.hydrateCutsceneDialogue === false
      ? content.cutscenes[selection.cutsceneId]
      : hydrateCutsceneDialogueCommands(
          content.cutscenes[selection.cutsceneId],
          content,
          `content.cutscenes.${selection.cutsceneId}`,
        );
    runtimeOptions.cutscene = {
      sequence,
      dialogue: options.cutsceneDialogue ?? defaultCutsceneDialogueOptions(content),
      ...(options.cutscene === undefined ? {} : options.cutscene),
    };
  }

  return runtimeOptions;
}

function dialogueGraphMap(value: unknown, path: string): Readonly<Record<string, ResolvedDialogueGraph>> {
  const graphs = optionalObject(value, path);
  const resolved: Record<string, ResolvedDialogueGraph> = {};
  for (const [id, graph] of Object.entries(graphs)) {
    const graphId = contentId(id, `${path} key`);
    resolved[graphId] = resolveDialogueGraph(graph as DialogueGraphSpec, {
      path: `${path}.${graphId}`,
    });
  }
  return resolved;
}

function cutsceneSequenceMap(value: unknown, path: string): Readonly<Record<string, ResolvedCutsceneSequenceSpec>> {
  const cutscenes = optionalObject(value, path);
  const resolved: Record<string, ResolvedCutsceneSequenceSpec> = {};
  for (const [id, sequence] of Object.entries(cutscenes)) {
    const cutsceneId = contentId(id, `${path} key`);
    resolved[cutsceneId] = resolveCutsceneSequenceSpec(sequence as CutsceneSequenceSpec, {
      path: `${path}.${cutsceneId}`,
    });
  }
  return resolved;
}

function selectContentId<T>(
  values: Readonly<Record<string, T>>,
  requested: string | false | undefined,
  path: string,
): string | undefined {
  if (requested === false) {
    return undefined;
  }
  if (requested !== undefined) {
    if (values[requested] !== undefined) {
      return requested;
    }
    throw gameSpecError(path, `must contain content id '${requested}'`);
  }
  const ids = Object.keys(values);
  return ids.length === 1 ? ids[0] : undefined;
}

function hydrateCutsceneDialogueCommands(
  sequence: ResolvedCutsceneSequenceSpec,
  content: ResolvedShooterContentSpec,
  path: string,
): ResolvedCutsceneSequenceSpec {
  return {
    ...sequence,
    commands: sequence.commands.map((command) =>
      command.kind === "dialogue"
        ? hydrateCutsceneDialogueCommand(command, content, `${path}.commands.${command.index}`)
        : command
    ),
  };
}

function hydrateCutsceneDialogueCommand(
  command: ResolvedCutsceneDialogueCommand,
  content: ResolvedShooterContentSpec,
  path: string,
): ResolvedCutsceneSequenceCommand {
  if (command.nodeId === undefined || command.text !== undefined) {
    return command;
  }
  const graphId = command.graphId ?? singleDialogueGraphId(content, `${path}.graphId`);
  const graph = content.dialogueGraphs[graphId];
  if (graph === undefined) {
    throw gameSpecError(`${path}.graphId`, `must reference content.dialogue.graphs id '${graphId}'`);
  }
  const node = graph.nodes[command.nodeId];
  if (node === undefined) {
    throw gameSpecError(`${path}.nodeId`, `must reference node '${command.nodeId}' in dialogue graph '${graphId}'`);
  }
  return {
    ...command,
    speaker: command.speaker ?? node.speaker,
    text: node.text,
  };
}

function singleDialogueGraphId(content: ResolvedShooterContentSpec, path: string): string {
  const graphIds = Object.keys(content.dialogueGraphs);
  if (graphIds.length === 1) {
    return graphIds[0];
  }
  throw gameSpecError(path, "must reference a dialogue graph when hydrating cutscene dialogue node text");
}

function defaultCutsceneDialogueOptions(
  content: ResolvedShooterContentSpec,
): FerrumRuntimeCutsceneDialogueOptions {
  return {
    textMode: content.localization === undefined ? "literal" : "localizationKey",
  };
}

function contentId(value: string, path: string): string {
  if (value.trim().length > 0) {
    return value;
  }
  throw gameSpecError(path, "must be a non-empty content id");
}

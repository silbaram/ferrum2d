import {
  setUiText,
  uiMessage,
  isUiMessage,
  type UiContent,
} from "./placementLocale";
import type {
  FerrumRuntime,
  GameplayEventView,
} from "@ferrum2d/ferrum-web/core";

interface RuntimeSummarySnapshot {
  mode: string;
  instanceId: string;
  gameplay: ReturnType<FerrumRuntime["engine"]["gameplayEntityDiagnostics"]>;
  variables: readonly { name: string; scope: string; value: unknown }[];
  recentEvents: readonly GameplayEventView[];
}

/** Owned presentation only. All readings are provided by the existing bounded 4 Hz query. */
export function createPlacementRuntimeSummary() {
  const element = document.createElement("section");
  element.className = "placement-runtime-summary";
  element.dataset.placementRuntimeSummary = "true";
  const context = document.createElement("p"),
    values = document.createElement("dl"),
    variables = document.createElement("details"),
    events = document.createElement("details");
  const variableTitle = document.createElement("summary"),
    eventTitle = document.createElement("summary"),
    variableValues = document.createElement("dl"),
    eventValues = document.createElement("ol");
  variables.append(variableTitle, variableValues);
  events.append(eventTitle, eventValues);
  element.append(context, values, variables, events);
  function row(list: HTMLElement, label: UiContent, value: unknown) {
    const key = document.createElement("dt"),
      text = document.createElement("dd");
    setUiText(key, label);
    if (isUiMessage(value)) setUiText(text, value);
    else text.textContent = String(value);
    list.append(key, text);
  }
  function clear(message: string) {
    setUiText(context, message);
    values.replaceChildren();
    variableValues.replaceChildren();
    eventValues.replaceChildren();
    variables.hidden = events.hidden = true;
  }
  clear("No runtime entity selected");
  return {
    element,
    clear,
    update(snapshot: RuntimeSummarySnapshot) {
      setUiText(
        context,
        uiMessage(
          "{0} · {1} · Read-only · 4 Hz",
          snapshot.instanceId,
          snapshot.mode === "game"
            ? uiMessage("Game Preview")
            : snapshot.mode === "spatial"
              ? uiMessage("HD-2D")
              : uiMessage("2D"),
        ),
      );
      values.replaceChildren();
      const game = snapshot.gameplay;
      row(
        values,
        "FSM",
        game?.stateId === undefined
          ? uiMessage("Not configured")
          : uiMessage("State {0}", game.stateId),
      );
      row(values, "Health", game?.health ?? uiMessage("Not configured"));
      row(
        values,
        "Timer",
        game?.timer
          ? uiMessage(
              "{0} · {1}",
              game.timer.id,
              game.timer.fired
                ? uiMessage("Fired")
                : uiMessage("{0} s", game.timer.remainingSeconds.toFixed(2)),
            )
          : uiMessage("Not configured"),
      );
      if (game?.actions.length)
        for (const action of game.actions)
          row(
            values,
            uiMessage("Action {0}", action.id),
            action.remainingSeconds > 0
              ? uiMessage("{0} s", action.remainingSeconds.toFixed(2))
              : uiMessage("Ready"),
          );
      else row(values, "Actions", uiMessage("None"));
      variableValues.replaceChildren();
      variables.hidden = false;
      setUiText(
        variableTitle,
        uiMessage("Variables ({0})", snapshot.variables.length),
      );
      if (!snapshot.variables.length)
        row(variableValues, "Scope", uiMessage("No global or scene variables"));
      for (const variable of snapshot.variables)
        row(
          variableValues,
          variable.name + " · " + variable.scope,
          variable.value,
        );
      eventValues.replaceChildren();
      events.hidden = false;
      setUiText(
        eventTitle,
        uiMessage("Recent Events ({0})", snapshot.recentEvents.length),
      );
      for (const event of [...snapshot.recentEvents].reverse()) {
        const item = document.createElement("li");
        setUiText(
          item,
          uiMessage(
            "Kind {0} · Actor {1}:{2} · Token {3}",
            event.kind,
            event.actorId,
            event.actorGeneration,
            event.tokenId,
          ),
        );
        eventValues.append(item);
      }
      if (!snapshot.recentEvents.length) {
        const item = document.createElement("li");
        setUiText(item, "No events recorded while this panel is open");
        eventValues.append(item);
      }
    },
  };
}

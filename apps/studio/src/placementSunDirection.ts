import { setUiText, uiMessage } from "./placementLocale";

/** Read-only world-XY bearings. Camera orbit must not change authored sunlight. */
export function createPlacementSunDirection() {
  const element = document.createElement("div");
  element.className = "placement-sun-direction";
  const diagram = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  diagram.setAttribute("viewBox", "0 0 72 72");
  diagram.setAttribute("aria-hidden", "true");
  diagram.innerHTML = `<circle cx="32" cy="32" r="24"/><path class="placement-sun-axes" d="M6 32H60M32 6V60"/>
    <text x="58" y="28">+X</text><text x="36" y="66">+Y</text>
    <path class="placement-sun-bearing" d="M32 32H54M49 28L54 32L49 36"/>
    <path class="placement-shadow-bearing" d="M32 32H54M49 28L54 32L49 36"/>`;
  const sun = diagram.querySelector<SVGPathElement>(".placement-sun-bearing")!;
  const shadow = diagram.querySelector<SVGPathElement>(".placement-shadow-bearing")!;
  const content = document.createElement("div"), bearing = document.createElement("output");
  bearing.dataset.placementSunBearing = "true";
  const meaning = document.createElement("p"), axes = document.createElement("p");
  meaning.dataset.placementSunMeaning = "true";
  setUiText(axes, "World XY · 0° = +X · 90° = +Y");
  content.append(bearing, meaning, axes); element.append(diagram, content);
  const degrees = (value: number) => {
    const wrapped = ((value + 180) % 360 + 360) % 360 - 180;
    return String(Number(wrapped.toFixed(1)));
  };
  return {
    element,
    sync(direction: { x: number; y: number }, spatial: boolean) {
      setUiText(meaning, spatial
        ? "Sun vector points toward the sun; shadows extend opposite."
        : "2D direction points along the shadow; the sun is opposite.");
      const vertical = Math.hypot(direction.x, direction.y) < 1e-12;
      sun.style.display = shadow.style.display = vertical ? "none" : "";
      if (vertical) {
        setUiText(bearing, "No horizontal direction");
        return;
      }
      const angle = Math.atan2(direction.y, direction.x) * 180 / Math.PI;
      const sunAngle = angle + (spatial ? 0 : 180), shadowAngle = sunAngle + 180;
      sun.setAttribute("transform", `rotate(${sunAngle} 32 32)`);
      shadow.setAttribute("transform", `rotate(${shadowAngle} 32 32)`);
      setUiText(bearing, uiMessage("Sun {0}° · Shadow {1}°", degrees(sunAngle), degrees(shadowAngle)));
    },
  };
}

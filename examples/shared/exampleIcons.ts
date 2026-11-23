import lucide from "./gallery/lucideIcons.json";

const icons: Record<string, string> = lucide.icons;

/** Inline Lucide icon from the bundled subset (ISC, see gallery/LICENSE-lucide.txt). */
export function exampleIcon(name: string, className = "example-icon"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ class: className, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    "stroke-width": "1.75", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" })) svg.setAttribute(key, value);
  svg.innerHTML = icons[name] ?? "";
  return svg;
}

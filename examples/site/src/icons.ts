import lucide from "./icons.json";

const icons: Record<string, string> = lucide.icons;

/** Inline Lucide icon from the bundled subset (ISC, see public/LICENSE-lucide.txt). */
export function icon(name: string, className = "i"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  for (const [key, value] of Object.entries({ class: className, viewBox: "0 0 24 24", "aria-hidden": "true" })) svg.setAttribute(key, value);
  svg.innerHTML = icons[name] ?? "";
  return svg;
}

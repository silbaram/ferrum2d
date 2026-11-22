import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Simulated dpkg-deb for release tests: `-R` unpacks a control file named the way
// Tauri names it, and `-b` packs the (possibly edited) control text with the payload.
export const TAURI_DEB_CONTROL = "Package: ferrum2-d-studio\nVersion: 0.1.0\nArchitecture: amd64\n" +
  "Depends: libwebkit2gtk-4.1-0, libgtk-3-0\nDescription: Ferrum2D Studio\n multi-line description\n";
const SEPARATOR = "\n--payload--\n";

export async function fakeDpkgDeb(args) {
  if (args[0] === "--version") return "Debian 'dpkg-deb' packaging tool version 1.21.1.\n";
  if (args[0] === "-R") {
    const [, deb, root] = args;
    await mkdir(path.join(root, "DEBIAN"), { recursive: true });
    await writeFile(path.join(root, "DEBIAN/control"), TAURI_DEB_CONTROL);
    await writeFile(path.join(root, "payload"), await readFile(deb));
    return "";
  }
  if (args[0] === "--root-owner-group" && args[1] === "-b") {
    const [, , root, output] = args;
    const control = await readFile(path.join(root, "DEBIAN/control"), "utf8");
    await writeFile(output, control + SEPARATOR + await readFile(path.join(root, "payload"), "utf8"));
    return "";
  }
  throw new Error(`Unexpected dpkg-deb arguments: ${args.join(" ")}`);
}

/** Control text of a package written by fakeDpkgDeb. */
export function fakeDebControl(text) {
  return text.split(SEPARATOR)[0];
}

/** Original installer bytes carried through a fakeDpkgDeb repack. */
export function fakeDebPayload(text) {
  return text.split(SEPARATOR)[1];
}

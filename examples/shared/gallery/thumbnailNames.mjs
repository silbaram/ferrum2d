// One naming rule for gallery thumbnails, shared by the catalog check, the gallery
// builder and the capture script. A thumbnail exists for every public gallery card.

/** Gallery cards that show a captured thumbnail, with the page each one is captured from. */
export function exampleThumbnailEntries({ catalog, features, physics }) {
  const labPath = id => catalog.find(item => item.id === id).path;
  return [
    ...catalog.filter(item => item.kind === "game" || item.kind === "tool")
      .map(item => ({ name: `${item.kind}-${item.id}.jpg`, path: item.path })),
    ...features.map(item => ({ name: `feature-${item.id}.jpg`, path: `${labPath("starter-runtime")}?feature=${item.id}` })),
    ...physics.map(item => ({ name: `physics-${item.id}.jpg`, path: `${labPath("physics-sandbox")}?demo=${item.id}` })),
  ];
}

export const EXAMPLE_THUMBNAIL_DIR = "examples/shared/thumbnails";

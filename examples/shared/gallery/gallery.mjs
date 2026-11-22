// Progressive enhancement for the example gallery: group filtering and search.
// Without JavaScript the sidebar links jump to sections and every card stays visible.
const gallery = document.querySelector("[data-example-gallery]");
if (gallery) {
  const searchBox = document.querySelector("[data-gallery-search]");
  const input = searchBox.querySelector("input");
  const links = [...gallery.querySelectorAll("[data-gallery-filter]")];
  const cards = [...gallery.querySelectorAll("[data-gallery-card]")];
  const sections = [...gallery.querySelectorAll("[data-gallery-section]")];
  const result = gallery.querySelector("[data-gallery-result]");
  const empty = gallery.querySelector("[data-gallery-empty]");
  const groups = new Set(links.map(link => link.dataset.galleryFilter));
  const params = new URLSearchParams(location.search);
  let group = groups.has(params.get("group")) ? params.get("group") : "all";
  input.value = params.get("q") ?? "";
  searchBox.hidden = false;

  const inGroup = cardGroup => group === "all" || group === cardGroup
    || (group === "features" && cardGroup.startsWith("topic:"));

  function apply({ updateUrl = true } = {}) {
    const query = input.value.trim().toLocaleLowerCase("ko");
    let visible = 0;
    for (const card of cards) {
      card.hidden = !inGroup(card.dataset.group) || !card.dataset.search.toLocaleLowerCase("ko").includes(query)
        && !card.querySelector(".card-title").textContent.toLocaleLowerCase("ko").includes(query);
      if (!card.hidden) visible++;
    }
    // Hide a section, or a topic inside the feature section, once none of its cards remain.
    for (const section of sections) section.hidden = !section.querySelector("[data-gallery-card]:not([hidden])");
    for (const link of links) {
      if (link.dataset.galleryFilter === group) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    }
    const filtered = group !== "all" || query;
    result.hidden = !filtered;
    result.textContent = filtered ? `${visible}개 예제` : "";
    empty.hidden = visible !== 0;
    if (updateUrl) {
      const url = new URL(location.href);
      if (query) url.searchParams.set("q", input.value.trim()); else url.searchParams.delete("q");
      if (group !== "all") url.searchParams.set("group", group); else url.searchParams.delete("group");
      url.hash = "";
      history.replaceState(null, "", url);
    }
  }

  for (const link of links) link.addEventListener("click", event => {
    event.preventDefault();
    group = link.dataset.galleryFilter;
    apply();
    gallery.querySelector(".content").scrollIntoView({ block: "start" });
  });
  input.addEventListener("input", () => apply());
  document.addEventListener("keydown", event => {
    if (event.key !== "/" || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    event.preventDefault();
    input.focus();
  });
  apply({ updateUrl: false });
}

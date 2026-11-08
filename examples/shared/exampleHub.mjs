// Progressive enhancement: all examples remain reachable when JavaScript is off.
const root = document.querySelector('[data-example-hub]');
if (root) {
  const input = root.querySelector('[data-feature-search]');
  const buttons = [...root.querySelectorAll('[data-feature-group]')];
  const cards = [...root.querySelectorAll('[data-feature-card]')];
  const count = root.querySelector('[data-feature-count]'), empty = root.querySelector('[data-feature-empty]');
  const params = new URLSearchParams(location.search);
  let group = buttons.some(button => button.dataset.featureGroup === params.get('group')) ? params.get('group') : 'all';
  input.value = params.get('q') ?? '';
  function filter() {
    const query = input.value.trim().toLocaleLowerCase('ko');
    let visible = 0;
    for (const card of cards) {
      card.hidden = (group !== 'all' && card.dataset.featureCategory !== group) || !card.textContent.toLocaleLowerCase('ko').includes(query);
      if (!card.hidden) visible++;
    }
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.featureGroup === group));
    count.textContent = `${visible} / ${cards.length}개 기능`; empty.hidden = visible !== 0;
    const url = new URL(location.href);
    if (query) url.searchParams.set('q', input.value.trim()); else url.searchParams.delete('q');
    if (group !== 'all') url.searchParams.set('group', group); else url.searchParams.delete('group');
    history.replaceState(null, '', url);
  }
  input.addEventListener('input', filter);
  for (const button of buttons) button.addEventListener('click', () => { group = button.dataset.featureGroup; filter(); });
  filter();
}

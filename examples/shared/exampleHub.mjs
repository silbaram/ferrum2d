// Progressive enhancement: all examples remain reachable when JavaScript is off.
const root = document.querySelector('[data-example-hub]');
if (root) {
  const input = root.querySelector('[data-feature-search]');
  const buttons = [...root.querySelectorAll('[data-feature-group]')];
  const cards = [...root.querySelectorAll('[data-feature-card]')];
  const count = root.querySelector('[data-feature-count]'), empty = root.querySelector('[data-feature-empty]');
  const dimension = root.querySelector('[data-feature-dimension]');
  const params = new URLSearchParams(location.search);
  let group = buttons.some(button => button.dataset.featureGroup === params.get('group')) ? params.get('group') : 'all';
  input.value = params.get('q') ?? '';
  dimension.value = ['2D', 'HD-2D'].includes(params.get('dimension')) ? params.get('dimension') : 'all';
  if (params.get('group') === 'HD-2D') dimension.value = 'HD-2D';
  function filter() {
    const query = input.value.trim().toLocaleLowerCase('ko');
    let visible = 0;
    for (const card of cards) {
      const section = card.closest('[data-topic-section]');
      const searchable = `${section.querySelector('header').textContent} ${card.textContent}`;
      card.hidden = (group !== 'all' && card.dataset.featureCategory !== group)
        || (dimension.value !== 'all' && !card.dataset.featureTags.split(' ').includes(dimension.value))
        || !searchable.toLocaleLowerCase('ko').includes(query);
      if (!card.hidden) visible++;
    }
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.featureGroup === group));
    for (const section of root.querySelectorAll('[data-topic-section]')) section.hidden = ![...section.querySelectorAll('[data-feature-card]')].some(card => !card.hidden);
    count.textContent = `${visible} / ${cards.length}개 실험`; empty.hidden = visible !== 0;
    const url = new URL(location.href);
    if (query) url.searchParams.set('q', input.value.trim()); else url.searchParams.delete('q');
    if (group !== 'all') url.searchParams.set('group', group); else url.searchParams.delete('group');
    if (dimension.value !== 'all') url.searchParams.set('dimension', dimension.value); else url.searchParams.delete('dimension');
    history.replaceState(null, '', url);
  }
  input.addEventListener('input', filter);
  dimension.addEventListener('change', filter);
  for (const button of buttons) button.addEventListener('click', () => { group = button.dataset.featureGroup; filter(); });
  filter();
}

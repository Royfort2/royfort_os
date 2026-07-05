/**
 * Cross-locale color name matching (swatch_list alias groups from theme settings).
 */
(function () {
  const BUILTIN_COLOR_OPTION_TRIGGERS = [
    'farbe',
    'color',
    'colour',
    'couleur',
    'kleur',
    'colore',
    'cor',
    'farve',
    'färg',
    'farg',
    'kolor',
    'hinta',
    'szín',
    'väri',
    'barva',
    'culoare',
    'renk',
    'farge',
  ];

  const normalize = (value) =>
    String(value || '')
      .trim()
      .replace(/\u00a0/g, ' ')
      .replace(/\s+/g, ' ')
      .toLowerCase();

  function parseColorNameGroups(raw) {
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function readGlobalColorNameGroups() {
    const el =
      document.getElementById('WeColorNameGroups-global') ||
      document.querySelector('script[data-we-color-name-groups-global]');
    return parseColorNameGroups(el?.textContent?.trim());
  }

  let cachedGlobalGroups = null;

  function getGlobalColorNameGroups() {
    if (cachedGlobalGroups) return cachedGlobalGroups;
    cachedGlobalGroups = readGlobalColorNameGroups();
    return cachedGlobalGroups;
  }

  function colorNamesMatch(a, b, groups) {
    const na = normalize(a);
    const nb = normalize(b);
    if (!na || !nb) return false;
    if (na === nb) return true;
    const list = groups?.length ? groups : getGlobalColorNameGroups();
    if (!list.length) return false;
    for (const group of list) {
      if (!Array.isArray(group)) continue;
      const normalizedGroup = group.map(normalize);
      if (normalizedGroup.includes(na) && normalizedGroup.includes(nb)) {
        return true;
      }
    }
    return false;
  }

  function readGroupsFromProductInfo(productInfoEl) {
    if (productInfoEl?.querySelector) {
      const script = productInfoEl.querySelector('script[data-we-color-name-groups]');
      const fromProduct = parseColorNameGroups(script?.textContent?.trim());
      if (fromProduct.length) return fromProduct;
    }
    return getGlobalColorNameGroups();
  }

  function isColorOptionName(optionName, triggerSetting) {
    const on = normalize(optionName);
    if (!on) return false;
    const tokens = String(triggerSetting || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
      .concat(BUILTIN_COLOR_OPTION_TRIGGERS);
    const seen = new Set();
    for (const t of tokens) {
      if (!t || seen.has(t)) continue;
      seen.add(t);
      if (on === t) return true;
    }
    return false;
  }

  window.WeColorI18n = {
    normalize,
    parseColorNameGroups,
    colorNamesMatch,
    readGroupsFromProductInfo,
    getGlobalColorNameGroups,
    isColorOptionName,
    BUILTIN_COLOR_OPTION_TRIGGERS,
  };
})();

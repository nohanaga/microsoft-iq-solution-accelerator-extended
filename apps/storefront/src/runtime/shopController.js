import { PRODUCTS as SAMPLE_PRODUCTS } from '../data/catalogue';
import { DEMO_PROMPTS } from '../data/demoPrompts';
import { BARISTA_PROMPT, BARISTA_TOOLS } from '../data/barista';
import { createLifecycle } from './lifecycle';
import { createHarnessClient } from './harnessClient';
import { createLiveVoice, LIVE_VOICES, readVoicePreferences, saveVoicePreferences, voiceFingerprint } from './liveVoiceClient';
import { createTodoView, renderMarkdown } from './chatContent';
export function mountShop(PRODUCTS = SAMPLE_PRODUCTS, dataMode = 'sample', initialStore = '神田店') {
  const lifecycle = createLifecycle();
  const { listen, setTimeout, clearTimeout, requestAnimationFrame, cancelAnimationFrame } = lifecycle;
  const originalTrace = document.getElementById('chat-trace');
  const traceParent = originalTrace.parentNode;
  const traceNext = originalTrace.nextSibling;
  const state = {
    category: 'beans',
    query: '',
    sort: 'recommended',
    view: 'catalog',
    compare: [],
    history: [],
    fields: {
      taste: true,
      ingredients: false,
      source: false,
    },
    cart: {},
    store: initialStore,
    storeId: document.getElementById('store-select')?.selectedOptions[0]?.dataset.storeId || '',
    pickupDate: document.getElementById('pickup-date')?.dateTime || '',
    time: '15:00',
    lastOrder: null,
    pendingOrder: null,
  };
  const byId = (id) => PRODUCTS.find((product) => product.id === id);
  const money = (amount) => `¥${amount.toLocaleString('ja-JP')}`;
  const price = (product) => product.net + Math.floor(product.net * product.tax);
  const escapeHtml = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          '&': '&amp;',
          '<': '&lt;',
          '>': '&gt;',
          '"': '&quot;',
          "'": '&#39;',
        })[char],
    );
  const icon = (name) => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const modeSuffix = dataMode === 'postgres' ? ':postgres' : '';
  const COMMERCE_KEY = `maikuro:maikuro-jp-v1:demo-customer-001:commerce:v2${modeSuffix}`;
  const emptyCommerce = () => ({
    version: 2,
    subject: 'demo-customer-001',
    lastOrder: null,
    productReviews: [],
    serviceFeedbacks: [],
  });
  const validDate = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));
  const validRating = (value) => Number.isInteger(value) && value >= 1 && value <= 5;
  function readCommerce() {
    const raw = localStorage.getItem(COMMERCE_KEY);
    if (!raw) return emptyCommerce();
    const saved = JSON.parse(raw);
    const order = saved?.lastOrder;
    if (
      saved?.version !== 2 ||
      saved.subject !== 'demo-customer-001' ||
      !Array.isArray(saved.productReviews) ||
      !Array.isArray(saved.serviceFeedbacks)
    )
      throw new Error('保存データを読み込めません。');
    if (
      order !== null &&
      (!order ||
        typeof order.id !== 'string' ||
        typeof order.number !== 'string' ||
        typeof order.store !== 'string' ||
        typeof order.storeId !== 'string' ||
        !validDate(order.pickupAt) ||
        !Number.isInteger(order.total) ||
        order.total < 0 ||
        !validDate(order.placedAt) ||
        !['ordered', 'received'].includes(order.status) ||
        (order.status === 'received' && !validDate(order.receivedAt)) ||
        !Array.isArray(order.items) ||
        !order.items.length ||
        !order.items.every(
          (item) =>
            typeof item.lineId === 'string' &&
            byId(item.id) &&
            Number.isInteger(item.quantity) &&
            item.quantity >= 1 &&
            item.quantity <= 9,
        ) ||
        new Set(order.items.map((item) => item.lineId)).size !== order.items.length)
    )
      throw new Error('注文データを読み込めません。');
    const validReview = (review) =>
      review &&
      typeof review.id === 'string' &&
      typeof review.orderId === 'string' &&
      validRating(review.rating) &&
      typeof review.body === 'string' &&
      review.body.trim().length > 0 &&
      review.body.length <= 1000 &&
      validDate(review.submittedAt);
    if (
      !saved.productReviews.every(
        (review) => validReview(review) && typeof review.lineId === 'string' && byId(review.productId),
      ) ||
      !saved.serviceFeedbacks.every(validReview)
    )
      throw new Error('投稿データを読み込めません。');
    if (
      new Set(saved.productReviews.map((review) => `${review.orderId}:${review.lineId}`)).size !==
        saved.productReviews.length ||
      new Set(saved.serviceFeedbacks.map((review) => review.orderId)).size !== saved.serviceFeedbacks.length
    )
      throw new Error('投稿データに重複があります。');
    return saved;
  }
  let commerce = emptyCommerce();
  let commerceReadIssue = false;
  function loadCommerce() {
    try {
      commerce = readCommerce();
      commerceReadIssue = false;
      state.lastOrder = commerce.lastOrder;
    } catch {
      commerceReadIssue = true;
    }
  }
  function saveCommerce(change) {
    try {
      const next = readCommerce();
      change(next);
      localStorage.setItem(COMMERCE_KEY, JSON.stringify(next));
      commerce = next;
      state.lastOrder = next.lastOrder;
      commerceReadIssue = false;
      return true;
    } catch {
      const message = '保存できませんでした。ブラウザーの保存設定をご確認ください。入力内容は残っています。';
      const error = document.getElementById('review-error');
      if (error) {
        error.textContent = message;
        error.hidden = false;
      } else toast(message);
      return false;
    }
  }
  function rememberOrder(order) {
    if (saveCommerce((next) => { next.lastOrder = order; })) return;
    commerce = { ...commerce, lastOrder: order };
    state.lastOrder = order;
    commerceReadIssue = false;
  }
  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      cache: 'no-store',
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error(body?.detail || '注文を処理できませんでした。');
      error.status = response.status;
      throw error;
    }
    if (!body?.order) throw new Error('注文 API の応答を確認してください。');
    return body;
  }
  function pickupLabel(value) {
    return new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo', month: 'long', day: 'numeric', weekday: 'short',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(value));
  }
  loadCommerce();
  let toastTimer;
  const MEMORY_KEY = `maikuro:maikuro-jp-v1:demo-customer-001:agent-memory:v2${modeSuffix}`;
  const MEMORY_OPTIONS = {
    roast: ['', '浅煎り', '中煎り', '中深煎り', '深煎り'],
    acidity: ['', 'low', 'bright'],
    flavor: ['', 'fruity', 'floral', 'nutty', 'chocolate'],
    brew: ['', 'ペーパードリップ', 'ネルドリップ', 'フレンチプレス'],
  };
  const MEMORY_LABELS = {
    roast: '焙煎度',
    acidity: '酸味',
    flavor: '風味',
    brew: 'いつもの淹れ方',
    budget: '一袋の予算',
  };
  const FLAVOR_LABELS = {
    fruity: 'フルーティ',
    floral: 'フローラル',
    nutty: 'ナッツ系',
    chocolate: 'チョコレート系',
  };
  let memoryReadIssue = false;
  function emptyMemory() {
    return {
      version: 2,
      subject: 'demo-customer-001',
      enabled: false,
      roast: '',
      acidity: '',
      flavor: '',
      brew: '',
      budget: null,
      source: 'conversation',
      records: {},
      updatedAt: null,
    };
  }
  function validPreference(field, value) {
    return field === 'budget'
      ? value === null || (Number.isInteger(value) && value >= 1 && value <= 20000)
      : MEMORY_OPTIONS[field]?.includes(value);
  }
  function readPreferenceMemory() {
    try {
      const raw = localStorage.getItem(MEMORY_KEY);
      memoryReadIssue = false;
      if (!raw) return emptyMemory();
      const parsed = JSON.parse(raw);
      const saved = parsed?.version === 2 ? { ...parsed, flavor: parsed.flavor ?? '' } : parsed;
      if (
        !saved ||
        saved.version !== 2 ||
        saved.subject !== 'demo-customer-001' ||
        saved.enabled !== true ||
        saved.source !== 'conversation'
      )
        throw new Error('Invalid memory');
      if (!Object.entries(MEMORY_OPTIONS).every(([field, values]) => values.includes(saved[field])))
        throw new Error('Invalid preference');
      if (!validPreference('budget', saved.budget)) throw new Error('Invalid budget');
      if (typeof saved.updatedAt !== 'string' || !Number.isFinite(Date.parse(saved.updatedAt)))
        throw new Error('Invalid date');
      if (!saved.records || typeof saved.records !== 'object' || Array.isArray(saved.records))
        throw new Error('Invalid records');
      const records = {};
      for (const field of Object.keys(MEMORY_LABELS)) {
        const record = saved.records[field];
        if (!record) {
          if (saved[field] !== emptyMemory()[field]) throw new Error('Missing provenance');
          continue;
        }
        if (
          record.field !== field ||
          record.value !== saved[field] ||
          record.source !== 'conversation' ||
          typeof record.evidence !== 'string' ||
          record.evidence.length > 160 ||
          typeof record.turnId !== 'string' ||
          !Number.isFinite(Date.parse(record.updatedAt))
        )
          throw new Error('Invalid provenance');
        records[field] = {
          field,
          value: record.value,
          source: 'conversation',
          evidence: record.evidence,
          turnId: record.turnId,
          updatedAt: record.updatedAt,
        };
      }
      return {
        ...emptyMemory(),
        enabled: true,
        roast: saved.roast,
        acidity: saved.acidity,
        flavor: saved.flavor,
        brew: saved.brew,
        budget: saved.budget,
        records,
        updatedAt: saved.updatedAt,
      };
    } catch {
      memoryReadIssue = true;
      return emptyMemory();
    }
  }
  let preferenceMemory = readPreferenceMemory();
  function savePreferenceMemories(preferences, evidence) {
    if (!preferences.length)
      return {
        changed: false,
        failed: false,
        savedFields: [],
      };
    const current = readPreferenceMemory();
    if (memoryReadIssue) {
      renderMemory();
      return {
        changed: false,
        failed: true,
      };
    }
    const next = {
      ...current,
      records: {
        ...current.records,
      },
    };
    const updatedAt = new Date().toISOString();
    const turnId = crypto.randomUUID();
    let changed = false;
    const savedFields = [];
    for (const item of preferences) {
      if (next[item.field] === item.value) continue;
      next[item.field] = item.value;
      next.records[item.field] = {
        field: item.field,
        value: item.value,
        source: 'conversation',
        evidence,
        updatedAt,
        turnId,
      };
      changed = true;
      savedFields.push(item.field);
    }
    if (!changed)
      return {
        changed: false,
        failed: false,
        savedFields: [],
      };
    next.enabled = true;
    next.updatedAt = updatedAt;
    try {
      localStorage.setItem(MEMORY_KEY, JSON.stringify(next));
    } catch {
      return {
        changed: false,
        failed: true,
        savedFields: [],
      };
    }
    preferenceMemory = next;
    memoryReadIssue = false;
    renderMemory();
    return {
      changed: true,
      failed: false,
      savedFields,
    };
  }
  function preferenceSummaryEntries(preferences) {
    return [
      { field: 'roast', text: preferences.roast },
      {
        field: 'acidity',
        text: preferences.acidity === 'low' ? '酸味ひかえめ' : preferences.acidity === 'bright' ? '明るい酸味' : '',
      },
      { field: 'flavor', text: FLAVOR_LABELS[preferences.flavor] || '' },
      { field: 'brew', text: preferences.brew },
      { field: 'budget', text: preferences.budget != null ? `一袋 ${money(preferences.budget)} 以内` : '' },
    ].filter((entry) => entry.text);
  }
  function preferenceSummary(preferences) {
    return preferenceSummaryEntries(preferences)
      .map((entry) => entry.text)
      .join(' · ');
  }
  function requestedPreferences(text) {
    const requested = {};
    const roast = text.match(/中深煎り|深煎り|中煎り|浅煎り/);
    if (roast) requested.roast = roast[0];
    if (/酸味.*(?:少な|控え|ひかえ|苦手|弱)|酸っぱ.*苦手/.test(text)) requested.acidity = 'low';
    else if (/酸味.*(?:強|好)|明るい酸味/.test(text)) requested.acidity = 'bright';
    if (/フルーティ|果実/.test(text)) requested.flavor = 'fruity';
    else if (/フローラル|花のよう|華やかな香り/.test(text)) requested.flavor = 'floral';
    else if (/ナッツ/.test(text)) requested.flavor = 'nutty';
    else if (/チョコレート|カカオ/.test(text)) requested.flavor = 'chocolate';
    if (/ペーパー/.test(text)) requested.brew = 'ペーパードリップ';
    else if (/ネル/.test(text)) requested.brew = 'ネルドリップ';
    else if (/フレンチプレス/.test(text)) requested.brew = 'フレンチプレス';
    const budget = text.match(/([\d,]+)\s*円\s*(?:以内|以下|まで)/);
    if (budget) requested.budget = Number(budget[1].replaceAll(',', ''));
    if (/予算.*(?:指定なし|制限なし|気にしない)/.test(text)) requested.budget = null;
    return requested;
  }
  function matchesFlavor(product, flavor) {
    const text = `${product.note || ''} ${product.description || ''}`;
    if (flavor === 'fruity') return /果実|フルーティ|柑橘|ベリー/.test(text);
    if (flavor === 'floral') return /花のよう|フローラル|華やか/.test(text);
    if (flavor === 'nutty') return /ナッツ/.test(text);
    if (flavor === 'chocolate') return /チョコレート|カカオ/.test(text);
    return false;
  }
  function beanRecommendations(text = '') {
    const requested = requestedPreferences(text);
    const criteria = {
      ...(preferenceMemory.enabled ? preferenceMemory : emptyMemory()),
      ...requested,
    };
    const candidates = PRODUCTS.filter(
      (product) => product.category === 'beans' && (criteria.budget == null || price(product) <= criteria.budget),
    )
      .filter((product) => !requested.roast || product.roast === requested.roast)
      .filter(
        (product) => !requested.acidity || (requested.acidity === 'low' ? product.acidity <= 2 : product.acidity >= 4),
      )
      .filter((product) => !requested.flavor || matchesFlavor(product, requested.flavor))
      .filter((product) => !requested.brew || product.brew.includes(requested.brew));
    const score = (product) =>
      (criteria.roast && product.roast === criteria.roast ? 4 : 0) +
      (criteria.acidity && (criteria.acidity === 'low' ? product.acidity <= 2 : product.acidity >= 4) ? 3 : 0) +
      (criteria.flavor && matchesFlavor(product, criteria.flavor) ? 4 : 0) +
      (criteria.brew && product.brew.includes(criteria.brew) ? 2 : 0);
    candidates.sort((first, second) => score(second) - score(first));
    return {
      candidates: candidates.slice(0, 3),
      criteria,
      requested,
    };
  }
  function memoryRecommendationReason(product, criteria) {
    const matches = [];
    if (criteria.roast && product.roast === criteria.roast) matches.push(product.roast);
    if (criteria.acidity && (criteria.acidity === 'low' ? product.acidity <= 2 : product.acidity >= 4))
      matches.push(criteria.acidity === 'low' ? '酸味ひかえめ' : '明るい酸味');
    if (criteria.flavor && matchesFlavor(product, criteria.flavor)) matches.push(FLAVOR_LABELS[criteria.flavor]);
    if (criteria.brew && product.brew.includes(criteria.brew)) matches.push(criteria.brew + '向き');
    return `${product.name} ${money(price(product))}: ${matches.join('、') || '味わいの比較候補'}`;
  }
  function renderMemory() {
    const summary = document.getElementById('memory-summary');
    if (memoryReadIssue) summary.textContent = '記憶を読み込めませんでした。';
    else if (!preferenceMemory.enabled) summary.textContent = 'まだ記憶はありません';
    else
      summary.innerHTML = preferenceSummaryEntries(preferenceMemory)
        .map((entry) => `<span class="memory-chip" data-field="${entry.field}">${escapeHtml(entry.text)}</span>`)
        .join('');
    const records = Object.values(preferenceMemory.records);
    document.getElementById('memory-count').textContent = String(records.length);
    document.getElementById('memory-list').innerHTML = records.length
      ? records
          .map(
            (record) =>
              `<li class="memory-record"><div class="memory-record-heading"><div><small>${MEMORY_LABELS[record.field]}</small><strong>${escapeHtml(
                preferenceSummary({
                  [record.field]: record.value,
                }),
              )}</strong></div><button class="icon-button" data-memory-remove="${record.field}" aria-label="${MEMORY_LABELS[record.field]}の記憶を削除" title="この記憶を削除">${icon('close')}</button></div><blockquote>${escapeHtml(record.evidence)}</blockquote><small>Agent が保存 · ${new Date(
                record.updatedAt,
              ).toLocaleString('ja-JP', {
                timeZone: 'Asia/Tokyo',
              })}</small></li>`,
          )
          .join('')
      : `<li class="memory-note">${memoryReadIssue ? '記憶を読み込めませんでした。' : 'まだ記憶はありません。'}</li>`;
    const pick = beanRecommendations().candidates[0];
    const pickContainer = document.getElementById('assistant-pick');
    pickContainer.innerHTML = pick
      ? `<button class="pick-product" data-detail="${pick.id}">${artwork(pick)}<span><strong>${pick.name}</strong><p>200 g · ${money(price(pick))}（税込）</p></span></button>`
      : '<p class="muted">ご予算内の珈琲豆はありません。</p>';
    document.querySelector('.pick-label').textContent = preferenceMemory.enabled
      ? 'お好みに合わせた一袋'
      : '今日のおすすめ';
  }
  function memoryError(message) {
    const output = document.getElementById('memory-error');
    output.textContent = message;
    output.hidden = false;
  }
  function openMemory() {
    renderMemory();
    document.getElementById('memory-error').hidden = true;
    document.getElementById('memory-delete-confirm').hidden = true;
    openDialog('memory-dialog');
  }
  function deletePreferenceMemory(field) {
    if (field && !Object.hasOwn(MEMORY_LABELS, field)) return false;
    const current = field ? readPreferenceMemory() : emptyMemory();
    const next = {
      ...current,
      records: {
        ...current.records,
      },
    };
    if (field) {
      delete next.records[field];
      next[field] = emptyMemory()[field];
    }
    next.enabled = Object.keys(next.records).length > 0;
    next.updatedAt = new Date().toISOString();
    try {
      if (field && memoryReadIssue) throw new Error('Unreadable memory');
      if (next.enabled) localStorage.setItem(MEMORY_KEY, JSON.stringify(next));
      else localStorage.removeItem(MEMORY_KEY);
    } catch {
      const message = '記憶を削除できませんでした。保存状態は変更していません。';
      memoryError(message);
      toast(message);
      return false;
    }
    preferenceMemory = next.enabled ? next : emptyMemory();
    memoryReadIssue = false;
    renderMemory();
    document.getElementById('memory-error').hidden = true;
    document.getElementById('memory-delete-confirm').hidden = true;
    toast(field ? `${MEMORY_LABELS[field]}の記憶を削除しました` : '記憶をすべて削除しました');
    return true;
  }
  const STAGE_STEP_MS = 620;
  const COMPARE_EXIT_MS = 300;
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let stageTimers = [];
  let compareStage = null;
  let fieldStage = null;
  const stagedCompare = () => (compareStage ? state.compare.slice(0, compareStage.limit) : state.compare);
  const stagedFields = () =>
    fieldStage
      ? Object.fromEntries(Object.entries(state.fields).map(([key, on]) => [key, on && !fieldStage.hidden.has(key)]))
      : state.fields;
  function clearStages() {
    for (const timer of stageTimers) clearTimeout(timer);
    stageTimers = [];
    compareStage = null;
    fieldStage = null;
  }
  function finishStages() {
    stageTimers = [];
    compareStage = null;
    fieldStage = null;
    renderShared();
    highlightAgentAction('#compare-view .comparison-scroll');
  }
  function runStages(steps) {
    clearStages();
    steps[0]();
    for (const [index, step] of steps.slice(1).entries()) stageTimers.push(setTimeout(step, (index + 1) * STAGE_STEP_MS));
    stageTimers.push(setTimeout(finishStages, steps.length * STAGE_STEP_MS));
  }
  function stageComparisonReveal(fromCount) {
    if (reducedMotion() || state.compare.length - fromCount < 2) return;
    const steps = [];
    for (let limit = fromCount + 1; limit <= state.compare.length; limit += 1) {
      const render = steps.length > 0;
      steps.push(() => {
        compareStage = { limit, enterIndex: limit - 1 };
        if (render) renderShared();
      });
    }
    runStages(steps);
  }
  function stageFieldReveal(addedFields) {
    if (reducedMotion() || addedFields.length < 2) return;
    const pending = new Set(addedFields);
    const steps = [
      () => {
        fieldStage = { hidden: new Set(pending), enterGroup: null };
      },
    ];
    for (const field of addedFields)
      steps.push(() => {
        pending.delete(field);
        fieldStage = { hidden: new Set(pending), enterGroup: field };
        renderShared();
      });
    runStages(steps);
  }
  // 列を消す前に退場を見せるため、再描画は呼び出し側で遅延させる
  function markComparisonExit(removedIds) {
    const view = document.getElementById('compare-view');
    if (reducedMotion() || view.hidden) return false;
    const columns = new Set();
    for (const id of removedIds) {
      const cell = view.querySelector(`[data-compare="${CSS.escape(id)}"]`)?.closest('td');
      if (cell) columns.add(cell.dataset.column);
    }
    if (!columns.size) return false;
    for (const column of columns)
      for (const cell of view.querySelectorAll(`td[data-column="${column}"]`)) cell.classList.add('stage-exit');
    return true;
  }
  function renderAfterCompareExit(removedIds) {
    if (markComparisonExit(removedIds)) setTimeout(renderShared, COMPARE_EXIT_MS);
    else renderShared();
  }
  function artwork(product) {
    if (product.image)
      return `<div class="photo-stage"><img src="${escapeHtml(product.image)}" alt="${escapeHtml(product.name)}" style="width:100%;height:100%;object-fit:cover" loading="lazy"></div>`;
    if (product.category === 'beans')
      return `<div class="photo-stage bean-stage" role="img" aria-label="${escapeHtml(product.name)}の豆袋の仮画像"><div class="bean-bag ${product.packTone}"><div class="bean-label"><small>舞黒珈琲店</small><strong>${product.packLabel}</strong><em>${product.roast}</em></div></div><span class="bean-mark" aria-hidden="true"></span><span class="image-placeholder">仮画像</span><span class="photo-volume">${product.volume}</span></div>`;
    return `<div class="photo-stage ${product.tone}" role="img" aria-label="${escapeHtml(product.name)}の仮画像"><div class="vessel ${product.vessel}"><span class="cup-mark">舞黒<small>MAIKURO COFFEE</small></span></div><span class="image-placeholder">仮画像</span><span class="photo-volume">${product.volume}</span></div>`;
  }
  function productCard(product) {
    const selected = stagedCompare().includes(product.id);
    return `<article class="product"><div class="product-top"><button class="product-photo" data-detail="${product.id}" aria-label="${product.name}の詳細">${artwork(product)}</button>${product.badge ? `<span class="product-badge">${product.badge}</span>` : ''}<button class="compare-toggle" data-compare="${product.id}" aria-pressed="${selected}" aria-label="${product.name}を比較${selected ? 'から外す' : 'に追加'}" title="${selected ? '比較から外す' : '比較に追加'}">${icon(selected ? 'check' : 'compare')}</button></div><div class="product-info"><p class="product-caption">${product.english}</p><button class="product-title" data-detail="${product.id}">${product.name}</button><p class="product-note">${product.note}</p>${product.category === 'beans' ? `<div class="bean-spec-line"><span class="bean-roast">${product.roast}</span><span>200 g / 豆のまま</span></div>` : ''}<div class="price-row"><div class="price">${money(price(product))}<small>税込</small></div><button class="add-button" data-add="${product.id}" aria-label="${product.name}をカートに追加" title="カートに追加">${icon('plus')}</button></div></div></article>`;
  }
  function renderCatalog() {
    const query = state.query.trim().toLowerCase();
    let products = PRODUCTS.filter(
      (product) =>
        (state.category === 'all' || product.category === state.category) &&
        `${product.name} ${product.english} ${product.note} ${product.origin || ''} ${product.roast || ''}`
          .toLowerCase()
          .includes(query),
    );
    if (state.sort !== 'recommended')
      products = products
        .slice()
        .sort((first, second) =>
          state.sort === 'price-low' ? price(first) - price(second) : price(second) - price(first),
        );
    document.getElementById('product-grid').innerHTML = products.map(productCard).join('');
    document.getElementById('catalog-empty').hidden = products.length > 0;
    document.getElementById('catalog-count').textContent = String(products.length);
    document.getElementById('bean-note').hidden = state.category !== 'beans';
    document.getElementById('shop-heading').textContent =
      state.category === 'beans' ? '珈琲豆のお品書き' : '舞黒珈琲店のお品書き';
    document
      .querySelectorAll('[data-category]')
      .forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.category === state.category)));
  }
  function meter(value, label) {
    if (value == null) return '対象外';
    return `<div class="meter" aria-label="${label} 5段階中${value}">${Array.from(
      {
        length: 5,
      },
      (_, index) => `<span class="${index < value ? 'on' : ''}"></span>`,
    ).join('')}</div>`;
  }
  function renderComparison() {
    const container = document.getElementById('compare-view');
    const visible = stagedCompare();
    if (!visible.length) {
      container.innerHTML = `<div class="empty">${icon('compare')}<h3 class="serif">どの一杯にしましょう。</h3><p>気になる商品を、最大 3 つまで。</p><button class="button primary" data-action="catalog-view">商品を選ぶ${icon('arrow')}</button></div>`;
      return;
    }
    const products = visible.map(byId);
    const fields = stagedFields();
    const hasBeans = products.some((product) => product.category === 'beans');
    const row = (label, content, group = '') =>
      `<tr${group ? ` data-group="${group}"` : ''}><th scope="row">${label}</th>${products.map((product, index) => `<td data-column="${index}">${content(product)}</td>`).join('')}</tr>`;
    const rows = [
      row(
        '商品',
        (product) =>
          `<div class="compare-cell"><button class="icon-button" data-compare="${product.id}" aria-label="${product.name}を比較から外す" title="比較から外す">${icon('close')}</button>${artwork(product)}<button class="product-title" data-detail="${product.id}">${product.name}</button></div>`,
      ),
      row('価格（税込）', (product) => `<span class="price">${money(price(product))}</span>`),
      row('内容量', (product) => `${product.volume}${product.category === 'beans' ? ' / 豆のまま' : ''}`),
    ];
    if (hasBeans)
      rows.push(
        row('生豆の産地', (product) => product.origin || '対象外'),
        row('焙煎度', (product) => product.roast || '対象外'),
        row('精製方法', (product) => product.process || '対象外'),
      );
    if (fields.taste) {
      if (hasBeans)
        rows.push(
          row('酸味', (product) => meter(product.acidity, '酸味'), 'taste'),
          row('コク', (product) => meter(product.body, 'コク'), 'taste'),
        );
      if (products.some((product) => product.category !== 'beans'))
        rows.push(row('甘さ', (product) => meter(product.sweet, '甘さ'), 'taste'));
      rows.push(
        row('苦味', (product) => meter(product.bitter, '苦味'), 'taste'),
        row('香り', (product) => meter(product.aroma, '香り'), 'taste'),
        row('味わい', (product) => product.note, 'taste'),
      );
      if (hasBeans) rows.push(row('おすすめの淹れ方', (product) => product.brew || '対象外', 'taste'));
    }
    if (fields.ingredients)
      rows.push(
        row('原材料・素材', (product) => product.ingredients, 'ingredients'),
        row(
          '甘さの変更',
          (product) => (['other', 'beans'].includes(product.category) ? '対象外' : '変更できません'),
          'ingredients',
        ),
      );
    rows.push(
      row(
        'お受け取り',
        () => `${escapeHtml(state.time)}<br><span class="muted">${escapeHtml(state.store)} · 店頭受取</span>`,
      ),
    );
    if (fields.source)
      rows.push(
        row(
          '根拠',
          (product) =>
            `<button class="source-button" data-source="${product.id}">${icon('file')}商品ガイドを見る</button>`,
          'source',
        ),
      );
    rows.push(
      row(
        '',
        (product) =>
          `<button class="button primary full" data-add="${product.id}">${icon('plus')}カートに入れる</button>`,
      ),
    );
    const stageChip = compareStage
      ? `<span class="stage-chip" role="status">比較表を作成中 ${products.length} / ${state.compare.length}</span>`
      : fieldStage
        ? '<span class="stage-chip" role="status">比較項目を追加中</span>'
        : '';
    container.innerHTML = `<div class="comparison-bar"><div class="comparison-heading"><h2 class="serif">${hasBeans ? '豆の個性を、比べて選ぶ。' : 'あなたに合う、一杯を。'}</h2><p>${products.length} 商品を比較中 · ${escapeHtml(state.store)}${stageChip}</p></div><button class="text-button" data-action="catalog-view">ほかの商品を追加</button></div><div class="field-options"><label><input type="checkbox" data-field="taste" ${fields.taste ? 'checked' : ''}>味の特徴</label><label><input type="checkbox" data-field="ingredients" ${fields.ingredients ? 'checked' : ''}>原材料</label><label><input type="checkbox" data-field="source" ${fields.source ? 'checked' : ''}>商品ガイド</label><button class="text-button" data-action="clear-compare" style="margin-left:auto;padding:0">すべて外す</button></div><div class="comparison-scroll" tabindex="0" role="region" aria-label="商品比較表"><table class="comparison-table" style="min-width:${80 + products.length * 178}px"><caption class="sr-only">商品比較</caption><tbody>${rows.join('')}</tbody></table></div><p class="muted" style="font-size:10px;margin-top:12px">産地・焙煎・精製・味の指標・原材料はデモ用の仮設定です。実際の販売商品や産地一般の品質を示すものではありません。</p>`;
    if (compareStage)
      for (const cell of container.querySelectorAll(`td[data-column="${compareStage.enterIndex}"]`))
        cell.classList.add('stage-enter');
    if (fieldStage?.enterGroup)
      for (const line of container.querySelectorAll(`tr[data-group="${fieldStage.enterGroup}"]`))
        line.classList.add('stage-enter');
  }
  function renderShared() {
    const shown = stagedCompare();
    document.getElementById('compare-count').textContent = String(shown.length);
    document.getElementById('tray-count').textContent = String(shown.length);
    document.getElementById('comparison-tray').hidden = !shown.length;
    document.getElementById('cart-count').textContent = String(
      Object.values(state.cart).reduce((total, quantity) => total + quantity, 0),
    );
    document.getElementById('chat-context').textContent = `${state.store} · ${state.time} 店頭受取`;
    renderCatalog();
    renderComparison();
  }
  function showView(view, scroll = false, updateHistory = true) {
    const previousView = state.view;
    state.view = view;
    const comparing = view === 'compare';
    const faq = view === 'faq';
    document.querySelector('.intro').hidden = faq;
    document.querySelector('.workspace').hidden = faq;
    document.getElementById('faq-view').hidden = !faq;
    document.getElementById('catalog-view').hidden = comparing || faq;
    document.getElementById('compare-view').hidden = !comparing;
    document.getElementById('searchbox').hidden = comparing;
    document.getElementById('catalog-tab').setAttribute('aria-selected', String(view === 'catalog'));
    document.getElementById('compare-tab').setAttribute('aria-selected', String(comparing));
    document.getElementById('catalog-tab').tabIndex = view === 'catalog' ? 0 : -1;
    document.getElementById('compare-tab').tabIndex = comparing ? 0 : -1;
    document
      .querySelectorAll('.header-nav button')
      .forEach((button) =>
        button.classList.toggle('active', !faq && button.dataset.action === (comparing ? 'compare-view' : 'all')),
      );
    document.querySelectorAll('[data-action="faq"]').forEach((button) => {
      if (faq) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    document.title = faq ? 'よくあるご質問 | 舞黒珈琲店 · v2' : '舞黒珈琲店 | 珈琲豆のお品書き · v2';
    const hash = faq ? '#faq' : comparing ? '#compare' : '#shop';
    if (updateHistory && location.hash !== hash) history.pushState(null, '', hash);
    if (comparing) renderComparison();
    if (scroll) {
      const target = faq ? document.getElementById('faq-heading') : document.querySelector('.view-toolbar');
      target.scrollIntoView({
        block: 'start',
        behavior: faq ? 'auto' : 'smooth',
      });
      if (faq)
        target.focus({
          preventScroll: true,
        });
      else if (previousView === 'faq')
        document.getElementById(comparing ? 'compare-tab' : 'catalog-tab').focus({
          preventScroll: true,
        });
    }
  }
  const agentActionHighlightTimers = new WeakMap();
  function highlightAgentAction(selector) {
    const target = document.querySelector(selector);
    if (!target) return;
    clearTimeout(agentActionHighlightTimers.get(target));
    target.classList.remove('agent-action-highlight');
    void target.offsetWidth;
    target.classList.add('agent-action-highlight');
    agentActionHighlightTimers.set(
      target,
      window.setTimeout(() => {
        target.classList.remove('agent-action-highlight');
        agentActionHighlightTimers.delete(target);
      }, 3200),
    );
  }
  function syncViewFromLocation() {
    const views = {
      '': 'catalog',
      '#shop': 'catalog',
      '#compare': 'compare',
      '#faq': 'faq',
    };
    if (Object.hasOwn(views, location.hash)) showView(views[location.hash], true, false);
  }
  function toast(message, undo = false) {
    clearTimeout(toastTimer);
    document.getElementById('toast-text').textContent = message;
    document.getElementById('undo-button').hidden = !undo;
    document.getElementById('toast').hidden = false;
    toastTimer = setTimeout(() => {
      document.getElementById('toast').hidden = true;
    }, 4200);
  }
  function saveComparisonHistory() {
    state.history.push({
      compare: [...state.compare],
      fields: {
        ...state.fields,
      },
    });
  }
  function toggleComparison(id) {
    if (!byId(id)) return;
    clearStages();
    const alreadySelected = state.compare.includes(id);
    if (!alreadySelected && state.compare.length >= 3) {
      toast('比較できる商品は 3 つまでです。ひとつ外して追加してください。');
      return;
    }
    saveComparisonHistory();
    state.compare = alreadySelected ? state.compare.filter((productId) => productId !== id) : [...state.compare, id];
    if (alreadySelected) renderAfterCompareExit([id]);
    else renderShared();
    toast(alreadySelected ? '比較から外しました' : '比較に追加しました', true);
  }
  const badgeBumpTimers = new WeakMap();
  function bumpBadge(badge) {
    if (!badge) return;
    clearTimeout(badgeBumpTimers.get(badge));
    badge.classList.remove('count-bump');
    void badge.offsetWidth;
    badge.classList.add('count-bump');
    badgeBumpTimers.set(
      badge,
      setTimeout(() => badge.classList.remove('count-bump'), 640),
    );
  }
  function bumpCart() {
    bumpBadge(document.querySelector('.cart-button .cart-count'));
  }
  function revealMemoryChips(fields) {
    bumpBadge(document.getElementById('memory-count'));
    if (reducedMotion()) return;
    fields.forEach((field, index) => {
      const chip = document.querySelector(`#memory-summary .memory-chip[data-field="${CSS.escape(field)}"]`);
      if (!chip) return;
      chip.style.animationDelay = `${index * 170}ms`;
      chip.classList.add('memory-chip-new');
    });
  }
  function cartFlightSource(id) {
    const selector = `[data-detail="${CSS.escape(id)}"], [data-add="${CSS.escape(id)}"]`;
    for (const scope of ['dialog[open]', '#compare-view', '#catalog-view']) {
      const root = document.querySelector(scope);
      if (!root || root.hidden) continue;
      const anchor = root.querySelector(selector);
      const source = anchor?.closest('article, td, .detail-layout')?.querySelector('.photo-stage') || anchor;
      if (source?.getBoundingClientRect().width) return source;
    }
    return null;
  }
  // 再描画で元のカードが消えるため、座標は更新前に採寸しておく
  function captureCartFlight(id, quantity) {
    const target = document.querySelector('.cart-button');
    const source = target && !reducedMotion() ? cartFlightSource(id) : null;
    if (!source) return bumpCart;
    const from = source.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const shiftX = to.left + to.width / 2 - (from.left + from.width / 2);
    const shiftY = to.top + to.height / 2 - (from.top + from.height / 2);
    const midY = from.top + from.height / 2 + shiftY * 0.45;
    const arcY = Math.max(-72, 8 + from.height * 0.28 - midY);
    return () => {
      const layer = document.querySelector('dialog[open]') || document.body;
      for (let index = 0; index < Math.min(quantity, 3); index += 1) {
        const flier = document.createElement('div');
        flier.className = 'cart-flight';
        flier.setAttribute('aria-hidden', 'true');
        flier.append(source.cloneNode(true));
        Object.assign(flier.style, {
          left: `${from.left}px`,
          top: `${from.top}px`,
          width: `${from.width}px`,
          height: `${from.height}px`,
        });
        layer.append(flier);
        const flight = flier.animate(
          [
            { transform: 'translate(0, 0) scale(1)', opacity: 1 },
            {
              transform: `translate(${shiftX * 0.45}px, ${shiftY * 0.45 + arcY}px) scale(0.56)`,
              opacity: 0.92,
              offset: 0.55,
            },
            { transform: `translate(${shiftX}px, ${shiftY}px) scale(0.1)`, opacity: 0.1 },
          ],
          { duration: 740, delay: index * 120, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' },
        );
        flight.onfinish = () => {
          flier.remove();
          bumpCart();
        };
        setTimeout(() => flier.remove(), 1500 + index * 120);
      }
    };
  }
  function addToCart(id, quantity = 1) {
    if (!byId(id)) return false;
    const current = state.cart[id] || 0;
    if (current + quantity > 9) {
      toast('一商品につき 9 点までお選びいただけます。');
      return false;
    }
    const launchFlight = captureCartFlight(id, quantity);
    state.cart[id] = current + quantity;
    renderShared();
    toast(`${byId(id).name}を ${quantity} 点追加しました`);
    launchFlight();
    return true;
  }
  function openDialog(id) {
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
    document.getElementById(id).showModal();
  }
  function beanDetails(product) {
    if (product.category !== 'beans') return '';
    return `<dl class="bean-detail"><dt>生豆の産地</dt><dd>${product.origin}</dd><dt>焙煎度</dt><dd>${product.roast}</dd><dt>精製方法</dt><dd>${product.process}</dd><dt>酸味</dt><dd>${meter(product.acidity, '酸味')}</dd><dt>コク</dt><dd>${meter(product.body, 'コク')}</dd><dt>淹れ方</dt><dd>${product.brew}</dd><dt>お渡し</dt><dd>200 g / 豆のまま</dd></dl>`;
  }
  function openDetail(id) {
    const product = byId(id);
    if (!product) return;
    document.getElementById('detail-body').innerHTML =
      `<div class="detail-layout">${artwork(product)}<div class="detail-info"><p class="eyebrow">${product.english}</p><h3 class="serif">${product.name}</h3><span class="price">${money(price(product))}<small>税込 / ${product.volume}</small></span><p class="detail-description">${product.description}</p><p style="font-size:11px">${icon('pin')} ${escapeHtml(state.store)} · ${escapeHtml(state.time)} 店頭受取</p><div class="detail-actions"><button class="button primary" data-add="${product.id}">${icon('plus')}カートに入れる</button><button class="button secondary" data-detail-compare="${product.id}">${icon('compare')}比較する</button></div>${beanDetails(product)}<div class="detail-spec"><p><strong>原材料・素材</strong><br>${product.ingredients}</p><p style="margin:10px 0">${['other', 'beans'].includes(product.category) ? '' : '甘さの変更はできません。'}</p><button class="source-button" data-source="${product.id}">${icon('file')}商品ガイド・原材料について</button><p class="muted" style="font-size:10px;margin-top:12px">商品情報・味わいはデモ用の仮設定です。</p></div></div></div>`;
    openDialog('detail-dialog');
  }
  function openSource(id) {
    const product = byId(id);
    if (!product) return;
    document.getElementById('source-body').innerHTML =
      `<p class="eyebrow">MAIKURO COFFEE / PRODUCT GUIDE</p><h3 class="serif">${product.name}</h3><p class="demo-tag" style="display:inline-block">資料表示サンプル · PDF・Foundry IQ 未接続</p><p>${product.description}</p>${beanDetails(product)}<dl><dt>商品 ID</dt><dd>${product.id}</dd><dt>内容量</dt><dd>${product.volume}</dd><dt>原材料・素材</dt><dd>${product.ingredients}</dd><dt>甘さの変更</dt><dd>${['other', 'beans'].includes(product.category) ? '対象外' : '変更できません'}</dd></dl><p class="muted">産地・精製方法・風味などはデザイン確認用の仮設定です。実際の販売商品や産地一般の品質を示すものではありません。</p>`;
    openDialog('source-dialog');
  }
  function cartTotals() {
    let net = 0;
    let reducedTax = 0;
    let standardTax = 0;
    Object.entries(state.cart).forEach(([id, quantity]) => {
      const product = byId(id);
      const subtotal = product.net * quantity;
      const tax = Math.floor(subtotal * product.tax);
      net += subtotal;
      if (product.tax === 0.08) reducedTax += tax;
      else standardTax += tax;
    });
    return {
      net,
      reducedTax,
      standardTax,
      total: net + reducedTax + standardTax,
    };
  }
  function renderCart() {
    document.getElementById('cart-heading').textContent = 'カート';
    const entries = Object.entries(state.cart);
    const container = document.getElementById('cart-body');
    if (!entries.length) {
      container.innerHTML = `<div class="empty">${icon('bag')}<h3 class="serif">カートは空です。</h3><p>今日の一杯を選びませんか。</p><button class="button primary" data-action="close-dialog">商品に戻る${icon('arrow')}</button></div>`;
      return;
    }
    const totals = cartTotals();
    container.innerHTML = `<p class="muted" style="font-size:11px">${icon('pin')} ${escapeHtml(state.store)} / ${escapeHtml(pickupLabel(`${state.pickupDate}T${state.time}:00+09:00`))} 店頭受取</p>${entries
      .map(([id, quantity]) => {
        const product = byId(id);
        return `<div class="cart-line">${artwork(product)}<div><h3>${product.name}</h3><p>${money(price(product))} × ${quantity}</p></div><div class="stepper"><button data-quantity="${id}" data-delta="-1" aria-label="${product.name}を1点減らす" title="1点減らす">${icon('minus')}</button><span>${quantity}</span><button data-quantity="${id}" data-delta="1" ${quantity >= 9 ? 'disabled' : ''} aria-label="${product.name}を1点増やす" title="1点増やす">${icon('plus')}</button></div></div>`;
      })
      .join(
        '',
      )}<div class="cart-summary"><div class="summary-row"><span>商品小計（税抜）</span><span>${money(totals.net)}</span></div>${totals.reducedTax ? `<div class="summary-row muted"><span>消費税等（8%）</span><span>${money(totals.reducedTax)}</span></div>` : ''}${totals.standardTax ? `<div class="summary-row muted"><span>消費税等（10%）</span><span>${money(totals.standardTax)}</span></div>` : ''}<div class="summary-row"><span>店頭受取料</span><span>無料</span></div><div class="summary-row total"><span>合計（税込）</span><strong>${money(totals.total)}</strong></div></div><p class="cart-footnote">決済は行いません。注文内容は業務データベースへ受注として保存されます。</p><button class="button primary full" data-action="checkout">注文を確定する${icon('arrow')}</button>`;
  }
  function openCart() {
    renderCart();
    openDialog('cart-dialog');
  }
  async function submitOrder() {
    const draft = {
      storeId: state.storeId,
      pickupAt: new Date(`${state.pickupDate}T${state.time}:00+09:00`).toISOString(),
      items: Object.entries(state.cart).map(([productId, quantity]) => ({ productId, quantity })),
    };
    const submission =
      state.pendingOrder && JSON.stringify(state.pendingOrder.draft) === JSON.stringify(draft)
        ? state.pendingOrder
        : { orderId: crypto.randomUUID(), draft };
    state.pendingOrder = submission;
    try {
      const result = await requestJson('/api/orders', {
        method: 'POST',
        body: JSON.stringify({ orderId: submission.orderId, ...submission.draft }),
      });
      state.pendingOrder = null;
      rememberOrder(result.order);
      submission.draft.items.forEach(({ productId, quantity }) => {
        if ((state.cart[productId] || 0) <= quantity) delete state.cart[productId];
        else state.cart[productId] -= quantity;
      });
      renderShared();
      showOrder(false);
      return result.order;
    } catch (error) {
      if (error.status && error.status < 500) state.pendingOrder = null;
      throw error;
    }
  }
  function showOrder(reload = true) {
    if (reload) loadCommerce();
    document.getElementById('cart-heading').textContent = 'ご注文履歴';
    if (commerceReadIssue) {
      document.getElementById('cart-body').innerHTML =
        `<p role="alert">注文・投稿の保存データを読み込めません。ブラウザーの保存設定をご確認ください。</p>`;
    } else if (!state.lastOrder) {
      document.getElementById('cart-body').innerHTML =
        `<div class="empty">${icon('bag')}<h3 class="serif">ご注文はまだありません。</h3><p>お選びいただいた商品はこちらに届きます。</p><button class="button secondary" data-action="close-dialog">商品に戻る</button></div>`;
    } else {
      const order = state.lastOrder;
      document.getElementById('cart-body').innerHTML =
        `<div class="checkout-receipt"><div class="receipt-icon">${icon('check')}</div><p class="eyebrow">ORDER</p><h3>${order.status === 'received' ? 'お受け取り済みです。' : 'ご注文を受け付けました。'}</h3><p>${escapeHtml(order.store)} · ${escapeHtml(pickupLabel(order.pickupAt))}<br>${order.status === 'received' ? '受取済み' : '受取待ち'}</p><div class="price">${money(order.total)}<small>税込</small></div><p>受付番号 ${escapeHtml(order.number)}<br>受注データは業務データベースに保存されています。</p></div>${order.items
          .map((item) => {
            const posted = commerce.productReviews.some(
              (review) => review.orderId === order.id && review.lineId === item.lineId,
            );
            return `<div class="order-review-line"><div><strong>${escapeHtml(byId(item.id).name)} × ${item.quantity}</strong><span class="muted">${posted ? 'レビュー投稿済み' : order.status === 'received' ? '受取済み' : '受取後にレビューを投稿できます'}</span></div>${order.status === 'received' ? `<button class="button secondary" data-review-line="${escapeHtml(item.lineId)}" data-order-id="${escapeHtml(order.id)}">${icon('file')}${posted ? '投稿内容を見る' : 'レビューを書く'}</button>` : ''}</div>`;
          })
          .join(
            '',
          )}<div class="review-actions">${order.status === 'ordered' ? `<button class="button primary" data-action="receive-order" data-order-id="${escapeHtml(order.id)}">受取済みにする${icon('check')}</button>` : ''}<button class="button secondary" data-action="close-dialog">商品に戻る${icon('arrow')}</button></div>`;
    }
    openDialog('cart-dialog');
  }
  let reviewDraft = null;
  function reviewContext(orderId, lineId) {
    loadCommerce();
    const order = commerce.lastOrder;
    const item = order?.items.find((entry) => entry.lineId === lineId);
    if (commerceReadIssue || order?.id !== orderId || order.status !== 'received' || !item) {
      toast('受取済みの注文明細を、ご注文履歴から選び直してください。');
      return null;
    }
    return {
      order,
      item,
      productReview: commerce.productReviews.find((review) => review.orderId === orderId && review.lineId === lineId),
      serviceFeedback: commerce.serviceFeedbacks.find((review) => review.orderId === orderId),
    };
  }
  function reviewTarget(context) {
    return `<p class="review-target"><strong>${escapeHtml(byId(context.item.id).name)} × ${context.item.quantity}</strong>${escapeHtml(context.order.store)} / 受付番号 ${escapeHtml(context.order.number)} / 受取済み</p>`;
  }
  function reviewSection(title, review) {
    return `<section class="review-section"><h3>${title}</h3><p>評価 ${review.rating} / 5</p><p class="review-body">${escapeHtml(review.body)}</p>${review.id ? `<span class="review-id">投稿 ID: ${escapeHtml(review.id)}</span><span class="review-id">投稿日時: ${escapeHtml(new Date(review.submittedAt).toLocaleString('ja-JP'))}</span>` : ''}</section>`;
  }
  function ratingInput(name, label, value) {
    const labels = ['不満', 'やや不満', 'ふつう', '満足', 'とても満足'];
    return `<label for="${name}">${label}（必須）</label><select id="${name}" name="${name}" required><option value="">評価を選ぶ</option>${labels.map((text, index) => `<option value="${index + 1}" ${Number(value) === index + 1 ? 'selected' : ''}>${index + 1} / 5 · ${text}</option>`).join('')}</select>`;
  }
  function openReview(orderId, lineId, keepDraft = false) {
    const context = reviewContext(orderId, lineId);
    if (!context) return;
    if (context.productReview) {
      showReviewReceipt(context);
      return;
    }
    if (!keepDraft || reviewDraft?.orderId !== orderId || reviewDraft?.lineId !== lineId)
      reviewDraft = {
        orderId,
        lineId,
        productRating: '',
        productBody: '',
        serviceRating: '',
        serviceBody: '',
      };
    document.getElementById('cart-heading').textContent = 'レビューを書く';
    document.getElementById('cart-body').innerHTML =
      `${reviewTarget(context)}<form id="review-form"><fieldset class="review-section"><legend>商品レビュー</legend>${ratingInput('productRating', '商品の評価', reviewDraft.productRating)}<label for="productBody">商品へのご感想（必須・1,000 文字以内）</label><textarea id="productBody" name="productBody" required maxlength="1000" placeholder="香りや味わい、量などについて">${escapeHtml(reviewDraft.productBody)}</textarea></fieldset>${context.serviceFeedback ? reviewSection('サービス評価（投稿済み）', context.serviceFeedback) : `<fieldset class="review-section"><legend>サービス評価</legend>${ratingInput('serviceRating', '受取・接客の評価', reviewDraft.serviceRating)}<label for="serviceBody">受取・接客へのご感想（必須・1,000 文字以内）</label><textarea id="serviceBody" name="serviceBody" required maxlength="1000" placeholder="待ち時間や受取時の対応などについて">${escapeHtml(reviewDraft.serviceBody)}</textarea></fieldset>`}<p class="cart-footnote">投稿はこのブラウザーに保存されます。公開・外部送信はされません。</p><p id="review-error" class="review-error" role="alert" hidden></p><div class="review-actions"><button type="button" class="button secondary" data-action="orders">注文履歴に戻る</button><button type="submit" class="button primary">入力内容を確認${icon('arrow')}</button></div></form>`;
    openDialog('cart-dialog');
    document.getElementById('productRating').focus();
  }
  function validReviewDraft(draft, serviceAlreadyPosted) {
    return (
      draft &&
      validRating(Number(draft.productRating)) &&
      draft.productBody.trim().length > 0 &&
      draft.productBody.length <= 1000 &&
      (serviceAlreadyPosted ||
        (validRating(Number(draft.serviceRating)) &&
          draft.serviceBody.trim().length > 0 &&
          draft.serviceBody.length <= 1000))
    );
  }
  function confirmReview() {
    if (!reviewDraft) return;
    const context = reviewContext(reviewDraft.orderId, reviewDraft.lineId);
    if (!context) return;
    if (context.productReview) {
      showReviewReceipt(context);
      return;
    }
    if (!validReviewDraft(reviewDraft, !!context.serviceFeedback)) {
      const error = document.getElementById('review-error');
      error.hidden = false;
      error.textContent = 'それぞれの評価とご感想を入力してください。空白だけのご感想は投稿できません。';
      return;
    }
    document.getElementById('cart-heading').textContent = '投稿内容の確認';
    document.getElementById('cart-body').innerHTML = `${reviewTarget(context)}${reviewSection('商品レビュー', {
      rating: Number(reviewDraft.productRating),
      body: reviewDraft.productBody.trim(),
    })}${reviewSection(
      context.serviceFeedback ? 'サービス評価（投稿済み）' : 'サービス評価',
      context.serviceFeedback || {
        rating: Number(reviewDraft.serviceRating),
        body: reviewDraft.serviceBody.trim(),
      },
    )}<p class="cart-footnote">このブラウザーに保存します。公開・外部送信はされません。</p><p id="review-error" class="review-error" role="alert" hidden></p><div class="review-actions"><button class="button secondary" data-action="edit-review">入力に戻る</button><button class="button primary" data-action="post-review">この内容で投稿する${icon('check')}</button></div>`;
    openDialog('cart-dialog');
  }
  function postReview() {
    if (!reviewDraft) return;
    const draft = {
      ...reviewDraft,
    };
    const context = reviewContext(draft.orderId, draft.lineId);
    if (!context) return;
    if (context.productReview) {
      showReviewReceipt(context);
      return;
    }
    if (!validReviewDraft(draft, !!context.serviceFeedback)) return;
    const saved = saveCommerce((next) => {
      const order = next.lastOrder;
      const item = order?.items.find((entry) => entry.lineId === draft.lineId);
      if (order?.id !== draft.orderId || order.status !== 'received' || !item) throw new Error('Order changed');
      if (next.productReviews.some((review) => review.orderId === order.id && review.lineId === item.lineId)) return;
      const submittedAt = new Date().toISOString();
      next.productReviews.push({
        id: `PR-${crypto.randomUUID()}`,
        orderId: order.id,
        lineId: item.lineId,
        productId: item.id,
        rating: Number(draft.productRating),
        body: draft.productBody.trim(),
        submittedAt,
      });
      if (!next.serviceFeedbacks.some((review) => review.orderId === order.id))
        next.serviceFeedbacks.push({
          id: `SF-${crypto.randomUUID()}`,
          orderId: order.id,
          orderStatus: order.status,
          rating: Number(draft.serviceRating),
          body: draft.serviceBody.trim(),
          submittedAt,
        });
    });
    if (saved) {
      const updated = reviewContext(draft.orderId, draft.lineId);
      if (updated) showReviewReceipt(updated, true);
    }
  }
  function showReviewReceipt(context, saved = false) {
    reviewDraft = null;
    document.getElementById('cart-heading').textContent = '投稿内容';
    document.getElementById('cart-body').innerHTML =
      `${saved ? `<p class="review-success" role="status">${icon('check')} 投稿を保存しました。</p>` : ''}${reviewTarget(context)}${reviewSection('商品レビュー', context.productReview)}${context.serviceFeedback ? reviewSection('サービス評価', context.serviceFeedback) : ''}<p class="cart-footnote">このブラウザー内の投稿です。公開・外部送信はされていません。</p><div class="review-actions"><button class="button secondary" data-action="orders">注文履歴に戻る</button></div>`;
    openDialog('cart-dialog');
  }
  function appendMessage(role, text, actionText = '', followups = []) {
    const container = document.getElementById('conversation');
    const message = document.createElement('div');
    message.className = `chat-message ${role}`;
    if (role === 'user') message.textContent = text;
    else {
      message.innerHTML = `<div class="message-label">${icon('chat')}バリスタ</div><div class="message-text"></div>${actionText ? `<div class="chat-action-result">${icon('check')}${escapeHtml(actionText)}</div>` : ''}${followups.length ? `<div class="chat-followup">${followups.map((prompt) => `<button data-prompt="${escapeHtml(prompt)}">${escapeHtml(prompt)}</button>`).join('')}</div>` : ''}`;
      renderMarkdown(message.querySelector('.message-text'), text);
    }
    container.appendChild(message);
    const scroller = document.getElementById('chat-messages');
    scroller.scrollTop = scroller.scrollHeight;
    return message;
  }
  function addRecommendations(ids) {
    saveComparisonHistory();
    const before = state.compare.length;
    const additions = ids.filter((id) => !state.compare.includes(id)).slice(0, 3 - state.compare.length);
    state.compare.push(...additions);
    stageComparisonReveal(before);
    renderShared();
    showView('compare');
    return additions.length;
  }
  function fitChatInput() {
    const input = document.getElementById('chat-input');
    input.style.height = '43px';
    input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
  }
  const harnessClient = createHarnessClient(executeBaristaTool);
  let harnessTurn = null;
  const agentToolProgressLabels = {
    get_shop_context: '商品と現在の画面を確認しています',
    remember_preferences: 'お客様メモリーを保存しています',
    update_comparison: '比較内容を更新しています',
    add_to_cart: 'カートを更新しています',
    quote_products: '合計金額を計算しています',
    place_order: 'ご注文を確定しています',
    forget_preference: 'お客様メモリーを更新しています',
  };
  function createAgentProgress(message) {
    const container = message.querySelector('.message-text');
    const progress = document.createElement('div');
    progress.className = 'agent-progress';
    progress.setAttribute('role', 'status');
    progress.setAttribute('aria-live', 'polite');
    progress.setAttribute('aria-atomic', 'true');
    progress.innerHTML = '<div class="agent-progress-status"><span class="agent-progress-pulse" aria-hidden="true"></span><span class="agent-progress-label">ご相談を確認しています</span></div><div class="agent-progress-track" aria-hidden="true"><span></span></div>';
    container.replaceChildren(progress);
    let active = true;
    return {
      update(label) {
        if (active) progress.querySelector('.agent-progress-label').textContent = label;
      },
      finish() {
        if (!active) return;
        active = false;
        progress.remove();
      },
    };
  }
  function agentToolProgressLabel(name) {
    if (typeof name === 'string' && name.startsWith('todos_')) return 'ご提案の手順を更新しています';
    return agentToolProgressLabels[name] || '必要な情報を確認しています';
  }
  const agentActionNotices = {
    update_comparison: '比較を更新しました',
    add_to_cart: 'カートを更新しました（注文は未確定）',
    remember_preferences: '好みをメモリーに保存しました',
    forget_preference: '記憶を削除しました',
  };
  function agentActionNotice(name, output) {
    if (name === 'place_order') return `ご注文を確定しました（受付番号 ${output?.order_number ?? '-'}）`;
    return agentActionNotices[name] || '';
  }
  function stopHarness() {
    const turn = harnessTurn;
    harnessTurn = null;
    harnessClient.close();
    if (turn) {
      turn.progress.finish();
      turn.todos.finish('cancelled');
      turn.node.querySelector('.message-label').textContent = 'バリスタ（応答を中断）';
      if (!turn.text) renderMarkdown(turn.node.querySelector('.message-text'), '相談を中断しました。');
      recordTraceEvent(turn.trace, 'ローカル', { type: 'agent.cancelled' });
    }
    renderVoice();
  }
  function sendChat(rawText) {
    if (!rawText.trim()) return '';
    if (voiceSession) {
      if (!voiceSession.ready) {
        voiceError('接続が完了してから送信してください。入力内容は残っています。');
        return '';
      }
      if (voiceSession.mode === 'live_jev') {
        if (voiceSession.sendText(rawText.trim())) {
          document.getElementById('chat-input').value = '';
          fitChatInput();
        }
      } else sendBaristaText(voiceSession, rawText.trim());
      return '';
    }
    void runHarnessChat(rawText.trim());
    return '';
  }
  async function runHarnessChat(text) {
    if (harnessTurn || harnessClient.busy) {
      voiceError('前の相談の応答を待つか、中断してください。入力内容は残っています。');
      return;
    }
    if (text.length > 8000) { voiceError('相談内容は8000文字以内で入力してください。'); return; }
    voiceError('');
    document.getElementById('chat-input').value = '';
    fitChatInput();
    for (const selector of ['.chat-welcome', '.quick-prompts', '.assistant-pick']) document.querySelector(selector).hidden = true;
    appendMessage('user', text);
    const trace = createChatTrace('Harness Agent');
    const node = appendMessage('agent', '');
    const turn = {
      trace,
      node,
      progress: createAgentProgress(node),
      todos: createTodoView(node),
      text: '',
      needsBreak: false,
      started: new Map(),
    };
    harnessTurn = turn;
    attachChatTrace(turn.node, trace);
    recordTraceEvent(trace, '送信', { type: 'agent.request', text });
    renderVoice();
    try {
      await harnessClient.run(text, (event) => {
        if (harnessTurn !== turn) return;
        recordTraceEvent(trace, '受信', event);
        if (event.type === 'agent.iteration') {
          if (event.iteration > 1) turn.needsBreak = true;
          turn.progress.update(event.iteration > 1 ? '結果を踏まえてご提案を整えています' : 'ご提案を組み立てています');
        }
        if (event.type === 'agent.text_delta' && typeof event.text === 'string') {
          turn.progress.finish();
          if (turn.needsBreak && turn.text) turn.text += '\n\n';
          turn.needsBreak = false;
          turn.text += event.text;
          renderMarkdown(turn.node.querySelector('.message-text'), turn.text);
        }
        if (event.type === 'agent.todos') {
          turn.todos.update(event.items);
          turn.progress.update('作業の進み具合を確認しています');
        }
        if (event.type === 'agent.tool_started') {
          turn.progress.update(agentToolProgressLabel(event.name));
          turn.needsBreak = true;
          turn.started.set(event.call_id, { event, at: performance.now() });
        }
        if (event.type === 'agent.tool_finished') {
          turn.progress.update('確認結果を整理しています');
          const start = turn.started.get(event.call_id);
          recordBaristaTool({ name: event.name, call_id: event.call_id, arguments: start?.event.arguments || {} },
            { id: event.run_id }, event.ok === false ? 'failed' : 'success', event.result || { ok: false },
            event.elapsed_ms || (start ? performance.now() - start.at : 0), null, null, trace);
          turn.started.delete(event.call_id);
        }
        if (event.type === 'agent.browser_result') {
          turn.progress.update('画面操作の結果を確認しています');
          if (!event.returned) voiceError('画面操作の結果を返送できませんでした。再送する前に現在の画面を確認してください。');
          const noticeText = event.output?.ok ? agentActionNotice(event.name, event.output) : '';
          if (noticeText) {
            const notice = document.createElement('div');
            notice.className = 'chat-action-result';
            notice.textContent = noticeText;
            turn.node.append(notice);
          }
        }
        if (event.type === 'agent.done') {
          turn.progress.finish();
          turn.todos.finish('done');
          if (event.unfinished) turn.text += '\n一部の作業が未完了です。条件を絞って改めてご相談ください。';
          renderMarkdown(turn.node.querySelector('.message-text'), turn.text || '回答を取得できませんでした。条件を変えてご相談ください。');
        }
        const scroller = document.getElementById('chat-messages');
        scroller.scrollTop = scroller.scrollHeight;
      });
      if (harnessTurn === turn && window.matchMedia('(max-width: 980px)').matches && state.view === 'compare') appendMobileReturn();
    } catch (error) {
      if (harnessTurn !== turn) return;
      turn.progress.finish();
      turn.todos.finish('error');
      turn.node.querySelector('.message-label').textContent = 'バリスタ（応答エラー）';
      renderMarkdown(turn.node.querySelector('.message-text'), `${turn.text ? `${turn.text}\n\n` : ''}${error.message || '相談を完了できませんでした。'}\n画面に反映済みの操作は取り消されません。`);
      recordTraceEvent(trace, 'ローカル', { type: 'agent.failed', detail: error.message });
    } finally {
      if (harnessTurn === turn) { harnessTurn = null; renderVoice(); }
    }
  }
  function appendMobileReturn() {
    const action = document.createElement('button');
    action.className = 'button secondary full';
    action.dataset.action = 'close-chat';
    action.textContent = '商品比較を見る';
    action.style.marginBottom = '18px';
    document.getElementById('conversation').appendChild(action);
    const scroller = document.getElementById('chat-messages');
    scroller.scrollTop = scroller.scrollHeight;
  }
  function undoComparison() {
    clearStages();
    const previous = state.history.pop();
    if (!previous) return;
    state.compare = previous.compare;
    state.fields = previous.fields;
    renderShared();
    toast('比較を元に戻しました');
  }
  function shopContext() {
    loadCommerce();
    preferenceMemory = readPreferenceMemory();
    renderMemory();
    return {
      data_origin: 'synthetic',
      currency: 'JPY',
      availability: 'unavailable',
      comparison_ids: [...state.compare],
      comparison_fields: {
        ...state.fields,
      },
      pickup: {
        store: state.store,
        time: state.time,
        date: state.pickupDate,
        confirmed: false,
      },
      products: PRODUCTS.map((product) => ({
        id: product.id,
        name: product.name,
        category: product.category,
        price_yen_including_tax: price(product),
        volume: product.volume,
        origin: product.origin,
        roast: product.roast,
        process: product.process,
        acidity: product.acidity,
        body: product.body,
        sweetness: product.sweet,
        bitterness: product.bitter,
        aroma: product.aroma,
        brew: product.brew,
        description: product.description,
        ingredients: product.ingredients,
      })),
      memory: memoryReadIssue
        ? {
            error: '保存済みの好みを取得できません',
          }
        : {
            summary: preferenceSummary(preferenceMemory),
            capture: 'agent_framework_context_provider',
            preferences: {
              roast: preferenceMemory.roast || null,
              acidity: preferenceMemory.acidity || null,
              flavor: preferenceMemory.flavor || null,
              brew: preferenceMemory.brew || null,
              budget_yen: preferenceMemory.budget,
            },
            updated_at: preferenceMemory.updatedAt,
          },
      cart: Object.entries(state.cart).map(([id, quantity]) => ({
        product_id: id,
        quantity,
      })),
      cart_total_yen_including_tax: cartTotals().total,
      last_order: commerceReadIssue
        ? {
            error: '注文を取得できません',
          }
        : state.lastOrder
          ? {
              status: state.lastOrder.status,
              store: state.lastOrder.store,
              total_yen: state.lastOrder.total,
              items: state.lastOrder.items.map((item) => ({
                product_id: item.id,
                quantity: item.quantity,
              })),
            }
          : null,
    };
  }
  async function executeBaristaTool(name, args) {
    if (!args || typeof args !== 'object' || Array.isArray(args))
      return {
        ok: false,
        error: '引数が不正です',
      };
    if (name === 'get_shop_context')
      return {
        ok: true,
        ...shopContext(),
      };
    if (name === 'update_comparison') {
      if (!Array.isArray(args.expected_ids) || JSON.stringify(args.expected_ids) !== JSON.stringify(state.compare))
        return {
          ok: false,
          error: '比較が変わりました。現在の状態を再取得してください',
          comparison_ids: [...state.compare],
        };
      if (
        !Array.isArray(args.product_ids) ||
        args.product_ids.length > 3 ||
        !args.product_ids.every((id) => typeof id === 'string' && byId(id)) ||
        new Set(args.product_ids).size !== args.product_ids.length
      )
        return {
          ok: false,
          error: '商品IDが不正です',
        };
      if (!['add', 'remove', 'details', 'undo'].includes(args.action))
        return {
          ok: false,
          error: '未対応の操作です',
        };
      if (['add', 'remove'].includes(args.action) && !args.product_ids.length)
        return {
          ok: false,
          error: '対象商品が必要です',
        };
      if (args.action === 'add') {
        if (new Set([...state.compare, ...args.product_ids]).size > 3)
          return {
            ok: false,
            error: '比較は最大3商品です。外す商品を確認してください',
          };
        addRecommendations(args.product_ids);
      } else if (args.action === 'remove') {
        clearStages();
        saveComparisonHistory();
        const removed = state.compare.filter((id) => args.product_ids.includes(id));
        state.compare = state.compare.filter((id) => !args.product_ids.includes(id));
        if (markComparisonExit(removed)) stageTimers.push(setTimeout(finishStages, COMPARE_EXIT_MS));
        else {
          renderShared();
          showView('compare');
        }
      } else if (args.action === 'details') {
        if (!state.compare.length)
          return {
            ok: false,
            error: '比較する商品を先に選んでください',
          };
        saveComparisonHistory();
        const addedFields = ['taste', 'ingredients', 'source'].filter((field) => !state.fields[field]);
        state.fields = {
          taste: true,
          ingredients: true,
          source: true,
        };
        stageFieldReveal(addedFields);
        renderShared();
        showView('compare');
      } else {
        if (!state.history.length)
          return {
            ok: false,
            error: '取り消せる操作がありません',
          };
        undoComparison();
        showView('compare');
      }
      if (!stageTimers.length) highlightAgentAction('#compare-view .comparison-scroll');
      return {
        ok: true,
        comparison_ids: [...state.compare],
        fields: {
          ...state.fields,
        },
      };
    }
    if (name === 'add_to_cart') {
      if (!byId(args.product_id) || !Number.isInteger(args.quantity) || args.quantity < 1 || args.quantity > 9)
        return {
          ok: false,
          error: '商品または数量が不正です',
        };
      const added = addToCart(args.product_id, args.quantity);
      if (added) highlightAgentAction('.cart-button');
      return {
        ok: added,
        error: added ? null : '一商品につき9点までです',
        quantity: state.cart[args.product_id] || 0,
        order_placed: false,
      };
    }
    if (name === 'quote_products') {
      if (
        !Array.isArray(args.items) ||
        !args.items.length ||
        args.items.length > PRODUCTS.length ||
        !args.items.every(
          (item) =>
            item &&
            byId(item.product_id) &&
            Number.isInteger(item.quantity) &&
            item.quantity >= 1 &&
            item.quantity <= 9,
        ) ||
        new Set(args.items.map((item) => item.product_id)).size !== args.items.length
      )
        return {
          ok: false,
          error: '商品明細が不正です',
        };
      return {
        ok: true,
        currency: 'JPY',
        total_yen_including_tax: args.items.reduce(
          (total, item) => total + price(byId(item.product_id)) * item.quantity,
          0,
        ),
        items: args.items,
        availability: 'unconfirmed',
      };
    }
    if (name === 'place_order') {
      const entries = Object.entries(state.cart);
      const cart = entries.map(([product_id, quantity]) => ({ product_id, quantity }));
      if (!entries.length)
        return {
          ok: false,
          error: 'カートが空です。先に商品を追加してください',
        };
      if (
        !Array.isArray(args.expected_items) ||
        args.expected_items.length !== entries.length ||
        !args.expected_items.every((item) => item && state.cart[item.product_id] === item.quantity) ||
        new Set(args.expected_items.map((item) => item.product_id)).size !== args.expected_items.length
      )
        return {
          ok: false,
          error: 'カートの内容が変わりました。現在の状態を再取得してください',
          cart,
        };
      const totals = cartTotals();
      if (args.expected_total_yen !== totals.total)
        return {
          ok: false,
          error: '合計金額が一致しません。金額を確認してお客様に伝えてください',
          total_yen_including_tax: totals.total,
          cart,
        };
      if (typeof args.confirmation !== 'string' || !args.confirmation.trim() || args.confirmation.length > 160)
        return {
          ok: false,
          error: '確定を了承したお客様の言葉を confirmation に入れてください',
        };
      openCart();
      const confirmButton = document.querySelector('#cart-body [data-action="checkout"]');
      if (confirmButton) {
        confirmButton.disabled = true;
        confirmButton.setAttribute('aria-busy', 'true');
      }
      try {
        const order = await submitOrder();
        highlightAgentAction('.checkout-receipt');
        return {
          ok: true,
          order_id: order.id,
          order_number: order.number,
          status: order.status,
          store: order.store,
          pickup_at: order.pickupAt,
          total_yen_including_tax: order.total,
          items: order.items.map((item) => ({ product_id: item.id, quantity: item.quantity })),
          payment: 'not_processed',
        };
      } catch (error) {
        if (confirmButton) {
          confirmButton.disabled = false;
          confirmButton.removeAttribute('aria-busy');
        }
        toast(error.message || '注文を確定できませんでした。');
        return {
          ok: false,
          error: error.message || '注文を確定できませんでした',
          order_placed: false,
        };
      }
    }
    if (name === 'remember_preferences') {
      const evidence = typeof args.evidence === 'string' ? args.evidence.trim() : '';
      const preferences = args.preferences;
      if (
        !Array.isArray(preferences) ||
        preferences.length < 1 ||
        preferences.length > 5 ||
        !evidence ||
        evidence.length > 160 ||
        preferences.some(
          (item) =>
            !item ||
            !Object.hasOwn(MEMORY_LABELS, item.field) ||
            !validPreference(item.field, item.value),
        ) ||
        new Set(preferences.map((item) => item.field)).size !== preferences.length
      )
        return {
          ok: false,
          error: '保存する好みの項目または値が不正です',
        };
      const result = savePreferenceMemories(preferences, evidence);
      if (result.failed)
        return {
          ok: false,
          error: '好みを保存できませんでした',
        };
      if (result.changed) {
        revealMemoryChips(result.savedFields);
        highlightAgentAction('.memory-strip');
      }
      return {
        ok: true,
        changed: result.changed,
        saved_fields: result.savedFields,
        memory: preferenceSummary(preferenceMemory),
      };
    }
    if (name === 'forget_preference') {
      if (![...Object.keys(MEMORY_LABELS), 'all'].includes(args.field))
        return {
          ok: false,
          error: '記憶の項目が不正です',
        };
      const deleted = deletePreferenceMemory(args.field === 'all' ? undefined : args.field);
      if (deleted) {
        bumpBadge(document.getElementById('memory-count'));
        highlightAgentAction('.memory-strip');
      }
      return {
        ok: deleted,
        memory: preferenceSummary(preferenceMemory),
      };
    }
    return {
      ok: false,
      error: '許可されていない操作です',
    };
  }
  let voiceSession = null;
  let voiceSettings = readVoicePreferences();
  let voiceModesConfig = null;
  let liveOrderReview = null;
  let liveCheckoutPending = false;
  const voiceAudio = document.getElementById('voice-audio');
  function voiceError(message, settings = false) {
    const element = document.getElementById(settings ? 'voice-settings-error' : 'voice-error');
    element.textContent = message;
    element.hidden = !message;
  }
  function renderVoice() {
    const owner = voiceSession;
    document.getElementById('chat-input').maxLength = owner?.mode === 'live_jev' ? 8000 : 500;
    document.getElementById('chat-data-notice').textContent = owner?.mode === 'live_jev'
      ? '音声は Azure、会話・商品・比較・カート・好み・直近の注文概要は TypeSafe に送信します（従量課金）。'
      : '相談では会話・商品・好み・注文情報を Azure に送信します（従量課金）。音声開始時は音声も送信し、新しい会話になります。';
    const button = document.getElementById('voice-toggle');
    button.setAttribute('aria-pressed', String(Boolean(owner)));
    button.title = owner ? 'バリスタへの音声相談を終了' : 'バリスタへの音声相談を開始';
    button.innerHTML = `${icon(owner ? 'stop' : 'mic')}<span>${owner ? '終了' : 'バリスタ監修 豆選びガイド'}</span>`;
    const liveStatuses = { connecting: '接続中', collecting: owner?.hearing ? '聞いています' : 'お話しください',
      deciding: '依頼を確認中', executing: '操作中', awaiting_confirmation: '確認待ち', completed: 'お話しください',
      cancelled: '操作を中断しました', unknown: '画面をご確認ください', closing: '接続を終了中' };
    document.getElementById('voice-status').textContent = owner?.mode === 'live_jev'
      ? owner.muted && owner.ready ? 'ミュート中' : liveStatuses[owner.status] || 'マイク停止'
      : !owner
      ? 'マイク停止'
      : !owner.ready
        ? '接続中'
        : owner.hearing
          ? '聞いています'
          : owner.playingId
            ? 'バリスタが応答中'
            : owner.reply || owner.requested
              ? '考えています'
              : owner.muted
                ? 'ミュート中'
                : 'お話しください';
    const mute = document.getElementById('voice-mute');
    mute.disabled = !owner?.ready;
    mute.setAttribute('aria-pressed', String(Boolean(owner?.muted)));
    mute.title = owner?.muted ? 'マイクをオン' : 'マイクをミュート';
    mute.setAttribute('aria-label', mute.title);
    mute.innerHTML = icon(owner?.muted ? 'mic' : 'mic-off');
    document.getElementById('voice-stop').disabled = owner?.mode === 'live_jev' ? owner.closing : !(harnessTurn || owner?.reply || owner?.playingId || owner?.requested);
    document.getElementById('voice-stop').title = owner?.mode === 'live_jev' ? '音声接続と未実行の操作を終了' : '応答を中断';
    document.getElementById('voice-stop').setAttribute('aria-label', document.getElementById('voice-stop').title);
    document.getElementById('voice-settings-open').disabled = Boolean(owner);
    document.getElementById('barista-mode').textContent = owner?.ready
      ? owner.mode === 'live_jev' ? 'GPT-Live + Jev' : 'リアルタイム音声対話'
      : 'テキスト相談';
  }
  function stopVoice(message = '', immediate = false) {
    const owner = voiceSession;
    liveOrderReview = null;
    if (owner?.mode === 'live_jev') { void owner.close(message, immediate); return; }
    voiceSession = null;
    if (owner) {
      recordTraceEvent(chatTraces.get(owner.traces?.get(owner.turn)), 'ローカル', {
        type: 'local.session_closed',
        reason: message || '接続を終了しました',
      });
      owner.abort.abort();
      clearTimeout(owner.deadline);
      clearTimeout(owner.responseDeadline);
      owner.channel?.close();
      owner.peer?.close();
      owner.stream?.getTracks().forEach((track) => track.stop());
      for (const [id, entry] of owner.messages) {
        if (!owner.transcribed.has(id) && entry.role === 'user')
          (entry.node.querySelector('.user-message-text') || entry.node).textContent = '（音声入力を終了しました）';
      }
    }
    voiceAudio.pause();
    voiceAudio.srcObject = null;
    voiceAudio.muted = false;
    document.getElementById('voice-resume').hidden = true;
    voiceError(message);
    renderVoice();
  }
  function clearChat() {
    stopHarness();
    stopVoice('', true);
    closeChatTrace();
    chatTraces.clear();
    document.getElementById('conversation').replaceChildren();
    document.getElementById('chat-input').value = '';
    document.getElementById('demo-prompt-select').value = '';
    fitChatInput();
    for (const selector of ['.chat-welcome', '.quick-prompts', '.assistant-pick'])
      document.querySelector(selector).hidden = false;
    document.getElementById('chat-messages').scrollTop = 0;
    document.getElementById('chat-input').focus({
      preventScroll: true,
    });
  }
  listen(document.getElementById('chat-clear'), 'click', clearChat);
  function voiceEvent(owner, event) {
    if (voiceSession !== owner || owner.channel?.readyState !== 'open') return false;
    try {
      owner.channel.send(JSON.stringify(event));
    } catch {
      stopVoice('音声通信が切れました。テキストでの相談は続けられます。');
      return false;
    }
    recordVoiceTrace(owner, event, '送信');
    return true;
  }
  function interruptVoice(owner) {
    owner.pendingResponse = false;
    if (owner.requested) owner.cancelledRequests.add(owner.requested);
    for (const response of owner.responses.values()) {
      if (!response.finished || response.id === owner.playingId) {
        response.cancelled = true;
        for (const id of response.messageIds) markBaristaInterrupted(owner, id);
      }
    }
    if (owner.reply)
      voiceEvent(owner, {
        type: 'response.cancel',
        response_id: owner.reply.id,
      });
    if (!owner.reply && !owner.playingId && !owner.requested) return;
    voiceAudio.muted = true;
    owner.playingId = null;
    voiceEvent(owner, {
      type: 'output_audio_buffer.clear',
    });
    renderVoice();
  }
  function requestBaristaResponse(owner, greeting = false) {
    if (voiceSession !== owner || !owner.ready || owner.reply || owner.requested || owner.hearing) return;
    owner.pendingResponse = false;
    owner.requested = crypto.randomUUID();
    voiceEvent(owner, {
      type: 'response.create',
      response: {
        metadata: {
          client_request_id: owner.requested,
        },
        ...(greeting
          ? {
              instructions: `${BARISTA_PROMPT}\n今は最初の挨拶だけを短く話してください。`,
            }
          : {}),
      },
    });
    watchBaristaResponse(owner);
    renderVoice();
  }
  function watchBaristaResponse(owner) {
    clearTimeout(owner.responseDeadline);
    owner.responseDeadline = setTimeout(() => {
      if (voiceSession === owner) stopVoice('バリスタの応答がタイムアウトしました。もう一度接続してください。');
    }, 90000);
  }
  function baristaMessage(owner, id, role, text, append = false, trace = null) {
    if (!id) return;
    document.querySelector('.chat-welcome').hidden = true;
    document.querySelector('.quick-prompts').hidden = true;
    document.querySelector('.assistant-pick').hidden = true;
    let entry = owner.messages.get(id);
    if (!entry) {
      entry = {
        role,
        node: appendMessage(role, ''),
        text: '',
      };
      owner.messages.set(id, entry);
    }
    trace = trace || (owner.traceItems?.has(id) ? chatTraces.get(owner.traceItems.get(id)) : baristaTrace(owner));
    if (trace) {
      (owner.traceItems ||= new Map()).set(id, trace.id);
      attachChatTrace(entry.node, trace);
    }
    entry.text = append ? entry.text + text : text;
    if (role === 'user') {
      let content = entry.node.querySelector('.user-message-text');
      if (!content) {
        content = document.createElement('span');
        content.className = 'user-message-text';
        entry.node.prepend(content);
      }
      content.textContent = entry.text;
    } else renderMarkdown(entry.node.querySelector('.message-text'), entry.text);
    const scroller = document.getElementById('chat-messages');
    scroller.scrollTop = scroller.scrollHeight;
  }
  function markBaristaInterrupted(owner, id) {
    const label = owner.messages.get(id)?.node.querySelector('.message-label');
    if (label) label.textContent = 'バリスタ（応答を中断）';
  }
  function sendBaristaText(owner, text) {
    owner.turn++;
    owner.toolCount = 0;
    interruptVoice(owner);
    const id = crypto.randomUUID().replaceAll('-', '');
    if (
      !voiceEvent(owner, {
        type: 'conversation.item.create',
        item: {
          id,
          type: 'message',
          role: 'user',
          content: [
            {
              type: 'input_text',
              text,
            },
          ],
        },
      })
    )
      return;
    owner.transcribed.add(id);
    baristaMessage(owner, id, 'user', text);
    document.getElementById('chat-input').value = '';
    fitChatInput();
    owner.pendingResponse = true;
    requestBaristaResponse(owner);
  }
  const chatTraces = new Map();
  const tracePanel = document.getElementById('chat-trace');
  let traceAnchor = null;
  let traceSelected = 'tools';
  let traceRenderFrame;
  function createChatTrace(source) {
    const trace = {
      id: crypto.randomUUID(),
      source,
      tools: [],
      events: [],
      bytes: 0,
      sequence: 0,
      dropped: 0,
    };
    chatTraces.set(trace.id, trace);
    while (chatTraces.size > 50) {
      const oldest = chatTraces.keys().next().value;
      if (traceAnchor?.dataset.traceId === oldest) closeChatTrace();
      chatTraces.delete(oldest);
    }
    return trace;
  }
  function baristaTrace(owner, turn = owner.turn) {
    owner.traces ||= new Map();
    if (!owner.traces.has(turn)) owner.traces.set(turn, createChatTrace('Realtime').id);
    return chatTraces.get(owner.traces.get(turn));
  }
  function responseTrace(owner, response) {
    return response?.traceId ? chatTraces.get(response.traceId) : baristaTrace(owner, response?.turn ?? owner.turn);
  }
  function recordVoiceTrace(owner, event, direction) {
    if (
      !/^(response\.|conversation\.item\.|input_audio_buffer\.|output_audio_buffer\.|error$)/.test(event.type) ||
      /^response\.output_audio\.(delta|done)$/.test(event.type)
    )
      return null;
    const responseId = event.response_id || event.response?.id;
    const response = owner.responses.get(responseId);
    const requestId = event.response?.metadata?.client_request_id;
    const itemId = event.item_id || event.item?.id;
    const callId = event.call_id || event.item?.call_id;
    const traceId =
      response?.traceId ||
      owner.traceRequests?.get(requestId) ||
      owner.traceCalls?.get(callId) ||
      owner.traceItems?.get(itemId);
    const trace = traceId
      ? chatTraces.get(traceId)
      : responseId && event.type !== 'response.created' && !response
        ? null
        : responseTrace(owner, response);
    if (!trace) return null;
    if (event.type === 'response.create' && requestId) (owner.traceRequests ||= new Map()).set(requestId, trace.id);
    if (itemId) (owner.traceItems ||= new Map()).set(itemId, trace.id);
    if (callId) (owner.traceCalls ||= new Map()).set(callId, trace.id);
    for (const item of event.response?.output || []) {
      if (item.id) (owner.traceItems ||= new Map()).set(item.id, trace.id);
      if (item.call_id) (owner.traceCalls ||= new Map()).set(item.call_id, trace.id);
    }
    recordTraceEvent(trace, direction, event);
    return trace;
  }
  function attachChatTrace(node, trace) {
    if (!trace || node.dataset.traceId) return;
    node.dataset.traceId = trace.id;
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'icon-button trace-trigger';
    button.setAttribute('aria-label', 'この応答のログを表示');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'chat-trace');
    button.title = '応答のログ';
    button.innerHTML = icon('file');
    actions.append(button);
    if (node.matches('.chat-message.agent')) {
      for (const [name, label] of [
        ['thumbs-up', 'よい回答'],
        ['thumbs-down', 'よくない回答'],
      ]) {
        const feedback = document.createElement('button');
        feedback.type = 'button';
        feedback.className = 'icon-button';
        feedback.disabled = true;
        feedback.setAttribute('aria-label', label);
        feedback.title = `${label}（未実装）`;
        feedback.innerHTML = icon(name);
        actions.append(feedback);
      }
    }
    node.append(actions);
  }
  function recordTraceEvent(trace, direction, event) {
    if (!trace || !chatTraces.has(trace.id) || /[._]delta$/.test(event.type)) return;
    const json = JSON.stringify(event, (key, value) => {
      if (/^(authorization|api[_-]?key|access_token|token|client_secret|sdp|instructions|audio)$/i.test(key))
        return '[除外]';
      return typeof value === 'string' && value.length > 12000 ? `${value.slice(0, 12000)}（省略）` : value;
    });
    if (json.length > 120000) {
      trace.dropped++;
      refreshChatTrace(trace);
      return;
    }
    trace.events.push({
      id: ++trace.sequence,
      at: new Date().toLocaleTimeString('ja-JP', {
        hour12: false,
      }),
      direction,
      type: event.type,
      json,
    });
    trace.bytes += json.length;
    while (trace.events.length > 200 || trace.bytes > 120000) {
      trace.bytes -= trace.events.shift().json.length;
      trace.dropped++;
    }
    refreshChatTrace(trace);
  }
  function refreshChatTrace(trace) {
    if (traceAnchor?.dataset.traceId !== trace?.id || tracePanel.hidden || traceRenderFrame) return;
    traceRenderFrame = requestAnimationFrame(() => {
      traceRenderFrame = null;
      renderChatTrace();
    });
  }
  function renderChatTrace() {
    const trace = chatTraces.get(traceAnchor?.dataset.traceId);
    const panel = document.getElementById('trace-content');
    const scroll = panel.scrollTop;
    const expanded = new Set(
      [...panel.querySelectorAll('details[open][data-event-id]')].map((node) => node.dataset.eventId),
    );
    panel.replaceChildren();
    document.getElementById('trace-source').textContent = trace?.source || '保持上限を超過';
    const note = (text) => {
      const node = document.createElement('p');
      node.className = 'trace-note';
      node.textContent = text;
      panel.append(node);
    };
    if (!trace) {
      note('この応答のログは保持上限を超えたため参照できません。');
      return;
    }
    if (traceSelected === 'tools') {
      if (!trace.tools.length)
        note(
          trace.source === '定型応答'
            ? '定型応答です。モデルのツール呼び出しはありません。'
            : 'ツール呼び出しはありません。',
        );
      panel.append(...trace.tools.slice().reverse());
    } else {
      if (traceSelected === 'reasoning')
        note(
          trace.source === '定型応答'
            ? 'LLM は使用していません。以下はローカル処理の記録です。'
            : '内部の思考過程は未取得です。以下は観測した処理イベントです。',
        );
      const events = trace.events.filter(
        (event) =>
          (traceSelected === 'reasoning'
            ? !/content_part|output_item/.test(event.type)
            : /function_call_arguments|output_(audio_transcript|text|item)|content_part|transcription|local.response|agent\.(todos|tool_|browser_result|iteration|done)/.test(
                event.type,
              )),
      );
      if (!events.length) note('記録されたイベントはありません。');
      for (const event of events) {
        const details = document.createElement('details');
        details.className = 'trace-event';
        details.dataset.eventId = String(event.id);
        const summary = document.createElement('summary');
        const time = document.createElement('small');
        time.textContent = `${event.at} ${event.direction}`;
        summary.append(time, document.createTextNode(event.type));
        details.append(summary);
        const populate = () => {
          if (!details.open || details.querySelector('pre')) return;
          const code = document.createElement('pre');
          renderToolDebugJson(code, event.json);
          details.append(code);
        };
        listen(details, 'toggle', populate);
        details.open = expanded.has(String(event.id));
        populate();
        panel.append(details);
      }
      if (trace.dropped) note(`保持上限による省略: ${trace.dropped} 件`);
    }
    panel.scrollTop = scroll;
  }
  function selectChatTraceTab(tab) {
    if (!['tools', 'reasoning', 'intermediate'].includes(tab)) return;
    traceSelected = tab;
    tracePanel.querySelectorAll('[role=tab]').forEach((button) => {
      const selected = button.dataset.traceTab === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
    });
    document.getElementById('trace-content').setAttribute('aria-labelledby', `trace-tab-${tab}`);
    document.getElementById('trace-content').scrollTop = 0;
    renderChatTrace();
  }
  function openChatTrace(anchor) {
    const changed = traceAnchor?.dataset.traceId !== anchor.dataset.traceId;
    const previous = traceAnchor?.querySelector('.trace-trigger');
    previous?.setAttribute('aria-expanded', 'false');
    previous?.setAttribute('aria-label', 'この応答のログを表示');
    traceAnchor = anchor;
    const trigger = anchor.querySelector('.trace-trigger');
    trigger?.setAttribute('aria-expanded', 'true');
    trigger?.setAttribute('aria-label', 'この応答のログを折りたたむ');
    anchor.after(tracePanel);
    tracePanel.hidden = false;
    if (changed) selectChatTraceTab('tools');
    else renderChatTrace();
    const scroller = document.getElementById('chat-messages');
    scroller.scrollTop += Math.max(
      0,
      tracePanel.getBoundingClientRect().bottom - scroller.getBoundingClientRect().bottom,
    );
  }
  function closeChatTrace() {
    cancelAnimationFrame(traceRenderFrame);
    traceRenderFrame = null;
    const trigger = traceAnchor?.querySelector('.trace-trigger');
    trigger?.setAttribute('aria-expanded', 'false');
    trigger?.setAttribute('aria-label', 'この応答のログを表示');
    tracePanel.hidden = true;
    document.body.append(tracePanel);
    traceAnchor = null;
    document.getElementById('trace-content').replaceChildren();
  }
  listen(tracePanel, 'click', (event) => {
    const button = event.target.closest('[data-trace-tab]');
    if (button) selectChatTraceTab(button.dataset.traceTab);
  });
  listen(tracePanel.querySelector('[role=tablist]'), 'keydown', (event) => {
    const tabs = [...tracePanel.querySelectorAll('[role=tab]')];
    const current = tabs.indexOf(document.activeElement);
    if (current < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? tabs.length - 1
          : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    selectChatTraceTab(tabs[next].dataset.traceTab);
    tabs[next].focus();
  });
  listen(document, 'click', async (event) => {
    const button = event.target.closest('.trace-trigger');
    if (!button) return;
    const anchor = button.closest('[data-trace-id]');
    if (traceAnchor === anchor && !tracePanel.hidden) closeChatTrace();
    else openChatTrace(anchor);
  });
  listen(
    document,
    'keydown',
    (event) => {
      if (
        event.key !== 'Escape' ||
        !traceAnchor ||
        (!tracePanel.contains(event.target) && !traceAnchor.contains(event.target))
      )
        return;
      event.preventDefault();
      event.stopImmediatePropagation();
      const trigger = traceAnchor.querySelector('.trace-trigger');
      closeChatTrace();
      trigger?.focus({
        preventScroll: true,
      });
    },
    true,
  );
  function toolDebugText(value) {
    const text = typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? 'null');
    return text.length > 24000 ? `${text.slice(0, 24000)}\n（表示上限のため省略）` : text;
  }
  function renderToolDebugJson(element, value) {
    let parsed = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch {
        element.dataset.format = 'invalid';
        element.textContent = `JSON 解析エラー\n\n${toolDebugText(value)}`;
        return;
      }
    }
    element.dataset.format = 'json';
    const text = toolDebugText(JSON.stringify(parsed, null, 2) ?? 'null');
    const fragment = document.createDocumentFragment();
    const tokens =
      /"(?:\\.|[^"\\])*"(?=\s*:)|"(?:\\.|[^"\\])*"|\b(?:true|false|null)\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
    let offset = 0;
    for (const match of text.matchAll(tokens)) {
      fragment.append(document.createTextNode(text.slice(offset, match.index)));
      const token = document.createElement('span');
      token.textContent = match[0];
      token.className = match[0].startsWith('"')
        ? /^\s*:/.test(text.slice(match.index + match[0].length))
          ? 'json-key'
          : 'json-string'
        : /^(true|false|null)$/.test(match[0])
          ? 'json-literal'
          : 'json-number';
      fragment.append(token);
      offset = match.index + match[0].length;
    }
    fragment.append(document.createTextNode(text.slice(offset)));
    element.replaceChildren(fragment);
  }
  function recordBaristaTool(item, result, status, output, elapsed, returned, owner, explicitTrace = null) {
    const trace = explicitTrace || responseTrace(owner, owner.responses.get(result.id));
    if (!trace) return;
    const entry = document.createElement('details');
    entry.className = 'tool-debug-entry';
    entry.dataset.status = status;
    entry.innerHTML =
      '<summary><span class="tool-debug-name"></span><span class="tool-debug-status"></span></summary><dl><dt>記録時刻</dt><dd data-debug="time"></dd><dt>ブラウザー処理</dt><dd data-debug="elapsed"></dd><dt>呼び出し ID</dt><dd data-debug="call"></dd><dt>応答 ID</dt><dd data-debug="response"></dd><dt>モデルへの返送</dt><dd data-debug="returned"></dd></dl><h4>引数</h4><pre data-debug="args"></pre><h4>結果</h4><pre data-debug="output"></pre>';
    if (explicitTrace) entry.querySelector('[data-debug="elapsed"]').previousElementSibling.textContent = 'ツール処理';
    entry.querySelector('.tool-debug-name').textContent = toolDebugText(item.name);
    entry.querySelector('.tool-debug-status').textContent = {
      success: '成功',
      failed: '失敗',
      skipped: '未実行',
    }[status];
    const fields = {
      time: new Date().toLocaleString('ja-JP', {
        hour12: false,
      }),
      elapsed: `${elapsed.toFixed(1)} ms`,
      call: item.call_id,
      response: result.id,
      returned: returned === null ? 'SDK が結果を受領（モデルへの送信は未確認）' : returned ? '送信済み' : '送信失敗',
    };
    for (const [key, value] of Object.entries(fields))
      entry.querySelector(`[data-debug="${key}"]`).textContent = toolDebugText(value);
    renderToolDebugJson(entry.querySelector('[data-debug="args"]'), item.arguments);
    renderToolDebugJson(entry.querySelector('[data-debug="output"]'), output);
    trace.tools.push(entry);
    while (trace.tools.length > 50) trace.tools.shift();
    recordTraceEvent(trace, 'ローカル', {
      type: 'tool.execution',
      name: item.name,
      call_id: item.call_id,
      response_id: result.id,
      status,
      returned,
      elapsed_ms: elapsed,
    });
  }
  async function completeBaristaResponse(owner, result) {
    const response = owner.responses.get(result.id);
    if (!response || response.handled) return;
    response.handled = true;
    response.finished = true;
    if (owner.reply?.id === result.id) {
      owner.reply = null;
      clearTimeout(owner.responseDeadline);
    }
    let toolReturned = false;
    for (const item of result.output || []) {
      if (item.type === 'message' && item.role === 'assistant') {
        const text = (item.content || []).map((part) => part.transcript || part.text || '').join('');
        if (!response.cancelled && text)
          baristaMessage(owner, item.id, 'agent', text, false, responseTrace(owner, response));
        if (response.cancelled) markBaristaInterrupted(owner, item.id);
      }
      if (item.type !== 'function_call' || owner.calls.has(item.call_id)) continue;
      owner.calls.add(item.call_id);
      const started = performance.now();
      let debugStatus = 'skipped';
      let output = {
        ok: false,
        error: '中断された依頼です。新しい発話を確認してください',
      };
      if (!response.cancelled && response.turn === owner.turn && result.status === 'completed') {
        try {
          owner.toolCount++;
          output =
            owner.toolCount <= 8
              ? await executeBaristaTool(item.name, JSON.parse(item.arguments))
              : {
                  ok: false,
                  error: '一度の相談で実行できる操作数を超えました。条件を絞ってください',
                };
        } catch {
          output = {
            ok: false,
            error: '操作を実行できませんでした。状態を確認してください',
          };
        }
        if (voiceSession !== owner) return;
        debugStatus = owner.toolCount > 8 ? 'skipped' : output.ok ? 'success' : 'failed';
        const noticeText = output.ok ? agentActionNotice(item.name, output) : '';
        if (noticeText) {
          const notice = document.createElement('div');
          notice.className = 'chat-action-result';
          notice.textContent = noticeText;
          document.getElementById('conversation').appendChild(notice);
          attachChatTrace(notice, responseTrace(owner, response));
        }
        toolReturned = true;
      }
      const returned = voiceEvent(owner, {
        type: 'conversation.item.create',
        item: {
          type: 'function_call_output',
          call_id: item.call_id,
          output: JSON.stringify(output),
        },
      });
      recordBaristaTool(item, result, debugStatus, output, performance.now() - started, returned, owner);
    }
    if (result.status === 'failed') voiceError('バリスタの応答に失敗しました。もう一度お話しください。');
    if (toolReturned && owner.toolCount > 8) {
      stopVoice('操作が多くなったため音声対話を終了しました。条件を絞って再接続してください。');
      return;
    }
    if (toolReturned) owner.pendingResponse = true;
    if (owner.pendingResponse) requestBaristaResponse(owner);
  }
  function receiveVoice(owner, event) {
    if (voiceSession !== owner) return;
    const eventTrace =
      event.type === 'input_audio_buffer.speech_started' ? null : recordVoiceTrace(owner, event, '受信');
    if (event.type === 'session.updated' && !owner.ready) {
      if (
        event.session?.tools?.some((tool) => tool.name === 'get_shop_context') &&
        event.session.audio?.input?.turn_detection?.create_response === true
      ) {
        clearTimeout(owner.deadline);
        owner.ready = true;
        owner.stream.getAudioTracks().forEach((track) => {
          track.enabled = true;
        });
        requestBaristaResponse(owner, true);
        renderVoice();
      }
      return;
    }
    if (event.type === 'error') {
      if (event.error?.code === 'response_cancel_not_active') return;
      stopVoice('音声サービスでエラーが発生しました。接続設定を確認してください。テキスト相談は続けられます。');
      return;
    }
    if (!owner.ready) return;
    if (event.type === 'input_audio_buffer.speech_started') {
      owner.turn++;
      owner.toolCount = 0;
      owner.hearing = !owner.muted;
      owner.activeInput = event.item_id;
      recordVoiceTrace(owner, event, '受信');
      interruptVoice(owner);
      if (owner.muted) owner.transcribed.add(event.item_id);
      else baristaMessage(owner, event.item_id, 'user', 'お話を聞いています…');
    } else if (event.type === 'input_audio_buffer.speech_stopped') {
      owner.hearing = false;
      owner.activeInput = null;
    } else if (event.type === 'conversation.item.input_audio_transcription.completed') {
      if (owner.transcribed.has(event.item_id)) return;
      owner.transcribed.add(event.item_id);
      const text = event.transcript?.trim();
      baristaMessage(owner, event.item_id, 'user', text || '（発話を文字にできませんでした）');
    } else if (event.type === 'conversation.item.input_audio_transcription.failed') {
      if (!owner.transcribed.has(event.item_id)) {
        owner.transcribed.add(event.item_id);
        baristaMessage(owner, event.item_id, 'user', '（文字起こしを取得できませんでした）');
      }
    } else if (event.type === 'response.created') {
      const requestId = event.response.metadata?.client_request_id;
      if (requestId === owner.requested) owner.requested = null;
      const response = {
        id: event.response.id,
        turn: owner.turn,
        traceId: eventTrace?.id,
        cancelled: owner.cancelledRequests.has(requestId),
        finished: false,
        messageIds: new Set(),
      };
      owner.responses.set(response.id, response);
      owner.reply = response;
      watchBaristaResponse(owner);
      if (response.cancelled)
        voiceEvent(owner, {
          type: 'response.cancel',
          response_id: response.id,
        });
    } else if (
      [
        'response.output_audio_transcript.delta',
        'response.output_audio_transcript.done',
        'response.output_text.delta',
        'response.output_text.done',
      ].includes(event.type)
    ) {
      const response = owner.responses.get(event.response_id);
      if (response && !response.cancelled) {
        response.messageIds.add(event.item_id);
        baristaMessage(
          owner,
          event.item_id,
          'agent',
          event.delta ?? event.transcript ?? event.text ?? '',
          event.type.endsWith('.delta'),
          responseTrace(owner, response),
        );
      }
    } else if (event.type === 'output_audio_buffer.started') {
      if (owner.responses.get(event.response_id)?.cancelled)
        voiceEvent(owner, {
          type: 'output_audio_buffer.clear',
        });
      else {
        owner.playingId = event.response_id;
        voiceAudio.muted = false;
      }
    } else if (['output_audio_buffer.stopped', 'output_audio_buffer.cleared'].includes(event.type)) {
      if (owner.playingId === event.response_id) owner.playingId = null;
    } else if (event.type === 'response.done')
      completeBaristaResponse(owner, event.response).catch(() => {
        if (voiceSession === owner) stopVoice('音声イベントを処理できませんでした。テキストでの相談は続けられます。');
      });
    renderVoice();
  }
  async function loadVoiceConfig(signal) {
    const response = await fetch('/api/config', {
      signal,
    }).catch((error) => {
      if (error.name === 'AbortError') throw error;
      throw new Error('ローカルサーバーに接続できません。サーバーの起動とアドレス・ポートをご確認ください。');
    });
    if (!response.ok)
      throw new Error('ローカルサーバーの接続設定を取得できません。サーバーの起動とアドレス・ポートをご確認ください。');
    const settings = await response.json().catch(() => null);
    if (
      !settings ||
      typeof settings.endpoint !== 'string' ||
      !settings.endpoint.trim() ||
      typeof settings.deployment !== 'string' ||
      !settings.deployment.trim() ||
      !['entra_id', 'api_key'].includes(settings.auth_mode)
    )
      throw new Error('ローカルサーバーの Azure 接続設定が不完全です。サーバー側の設定をご確認ください。');
    return settings;
  }
  function updateVoiceChoices() {
    const mode = document.getElementById('voice-mode-choice').value;
    const live = mode === 'live_jev';
    const voices = live ? LIVE_VOICES : ['verse', 'alloy', 'ash', 'ballad', 'coral', 'echo', 'sage', 'shimmer'];
    document.getElementById('voice-choice').replaceChildren(...voices.map(voice => new Option(voice, voice)));
    document.getElementById('voice-choice').value = live ? voiceSettings.liveVoice : voiceSettings.realtimeVoice;
    document.getElementById('voice-data-notice').hidden = !live;
    const detail = document.getElementById('voice-mode-detail');
    detail.textContent = !voiceModesConfig?.modes?.live_jev?.configured
      ? voiceModesConfig?.modes?.live_jev?.detail || (live ? '接続設定を確認しています。' : '') : '';
    detail.hidden = !detail.textContent;
  }
  async function openVoiceSettings() {
    if (voiceSession) return;
    document.getElementById('voice-mode-choice').value = voiceSettings.mode;
    updateVoiceChoices();
    openDialog('voice-settings');
    voiceError('', true);
    try {
      const response = await fetch('/api/voice/config');
      if (!response.ok) throw new Error('音声方式の設定を取得できませんでした。');
      voiceModesConfig = await response.json();
      document.querySelector('#voice-mode-choice option[value="live_jev"]').disabled = !voiceModesConfig?.modes?.live_jev?.configured;
      updateVoiceChoices();
    } catch (error) { voiceError(error.message, true); }
  }
  function startLiveVoice() {
    let trace = createChatTrace('GPT-Live + Jev');
    let requestId = trace.id;
    let pendingProgress = null;
    const completedLabels = { get_shop_context: '商品・状態の確認', update_comparison: '比較更新', add_to_cart: 'カート追加',
      quote_products: '見積もり', remember_preferences: '好みの保存', forget_preference: '好みの削除' };
    function finishProgress() {
      if (!pendingProgress) return;
      baristaMessage(owner, `result_${pendingProgress.id}`, 'agent', '依頼の処理を中断しました。実行済みの操作は画面でご確認ください。', false, trace);
      pendingProgress = null;
    }
    const owner = createLiveVoice({
      audio: voiceAudio,
      context: shopContext,
      execute: (name, args) => executeBaristaTool(name, args),
      change: renderVoice,
      error: message => { if (voiceSession === owner) voiceError(message); },
      resume: () => { if (voiceSession === owner) document.getElementById('voice-resume').hidden = false; },
      closed: message => {
        if (voiceSession !== owner) return;
        voiceSession = null;
        liveOrderReview = null;
        document.getElementById('voice-resume').hidden = true;
        voiceError(message);
        renderVoice();
      },
      transcript: (id, role, text) => {
        if (voiceSession !== owner) return;
        baristaMessage(owner, id, role, text, false, trace);
        if (role === 'agent') owner.messages.get(id).node.querySelector('.message-label').textContent = id.startsWith('result_') ? '操作結果' : 'バリスタ（GPT-Live）';
      },
      request: id => {
        finishProgress();
        requestId = id;
        trace = createChatTrace('GPT-Live + Jev');
        pendingProgress = { id };
        voiceError('');
      },
      trace: event => recordTraceEvent(trace, event.direction || 'ローカル', event),
      progress: (status, detail) => {
        recordTraceEvent(trace, 'ローカル', { type: 'voice.work_state', status, ...(detail?.work_state || {}) });
        if (voiceSession !== owner || !pendingProgress) return;
        if (['deciding', 'executing'].includes(status)) {
          const completed = (detail?.work_state?.completed || []).filter(item => item.ok).map(item => completedLabels[item.operation] || '操作');
          const label = status === 'deciding' ? 'ご相談を確認しています。' : agentToolProgressLabels[detail?.action?.name] || '操作しています。';
          baristaMessage(owner, `result_${requestId}`, 'agent', `${label}${completed.length ? `\n\n完了: ${completed.join('、')}` : ''}`, false, trace);
          owner.messages.get(`result_${requestId}`).node.querySelector('.message-label').textContent = '処理状況';
        } else if (['collecting', 'cancelled', 'closing'].includes(status)) finishProgress();
        else pendingProgress = null;
      },
      tool: (action, output, elapsed, returned) => recordBaristaTool(
        { name: action.name, call_id: action.action_id, arguments: JSON.stringify(action.arguments) },
        { id: requestId }, output.ok === true ? 'success' : 'failed', output, elapsed, returned, null, trace),
      order: fingerprint => {
        liveOrderReview = fingerprint;
        if (fingerprint && voiceSession === owner) openCart();
      },
    });
    owner.messages = new Map();
    voiceSession = owner;
    voiceError('');
    renderVoice();
    void owner.start(voiceSettings.liveVoice);
  }
  async function startVoice() {
    if (voiceSession) {
      stopVoice();
      return;
    }
    stopHarness();
    if (voiceSettings.mode === 'live_jev') { startLiveVoice(); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      voiceError('マイクを利用できる Edge / Chrome でローカルサーバーのショップを開いてください。');
      return;
    }
    const owner = {
      abort: new AbortController(),
      ready: false,
      muted: false,
      hearing: false,
      reply: null,
      playingId: null,
      requested: null,
      pendingResponse: false,
      turn: 0,
      toolCount: 0,
      responses: new Map(),
      cancelledRequests: new Set(),
      calls: new Set(),
      messages: new Map(),
      transcribed: new Set(),
    };
    voiceSession = owner;
    voiceError('');
    renderVoice();
    owner.deadline = setTimeout(() => {
      if (voiceSession === owner)
        stopVoice('音声接続がタイムアウトしました。マイクの許可とネットワークをご確認ください。');
    }, 60000);
    try {
      const settings = await loadVoiceConfig(owner.abort.signal);
      if (voiceSession !== owner) return;
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (voiceSession !== owner) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      owner.stream = stream;
      owner.peer = new RTCPeerConnection();
      stream.getTracks().forEach((track) => {
        track.enabled = false;
        owner.peer.addTrack(track, stream);
        track.onended = () => {
          if (voiceSession === owner) stopVoice('マイクが切断されました。接続を確認してください。');
        };
      });
      owner.peer.ontrack = (event) => {
        if (voiceSession !== owner) return;
        voiceAudio.srcObject = event.streams[0] || new MediaStream([event.track]);
        voiceAudio.play().catch(() => {
          if (voiceSession === owner) document.getElementById('voice-resume').hidden = false;
        });
      };
      owner.peer.onconnectionstatechange = () => {
        if (voiceSession === owner && ['disconnected', 'failed', 'closed'].includes(owner.peer.connectionState))
          stopVoice('音声接続が切れました。もう一度接続してください。');
      };
      owner.channel = owner.peer.createDataChannel('oai-events');
      owner.channel.onopen = () => {
        if (voiceSession !== owner) return;
        voiceEvent(owner, {
          type: 'session.update',
          session: {
            type: 'realtime',
            instructions: BARISTA_PROMPT,
            tools: BARISTA_TOOLS,
            tool_choice: 'auto',
            audio: {
              input: {
                turn_detection: {
                  type: 'server_vad',
                  threshold: 0.5,
                  prefix_padding_ms: 300,
                  silence_duration_ms: 600,
                  create_response: true,
                  interrupt_response: true,
                },
              },
            },
          },
        });
      };
      owner.channel.onmessage = (message) => {
        if (voiceSession !== owner) return;
        try {
          receiveVoice(owner, JSON.parse(message.data));
        } catch {
          stopVoice('音声イベントを処理できませんでした。テキストでの相談は続けられます。');
        }
      };
      owner.channel.onclose = () => {
        if (voiceSession === owner) stopVoice('音声接続が終了しました。');
      };
      owner.channel.onerror = () => {
        if (voiceSession === owner) stopVoice('音声通信でエラーが発生しました。');
      };
      const offer = await owner.peer.createOffer();
      if (voiceSession !== owner) return;
      await owner.peer.setLocalDescription(offer);
      if (voiceSession !== owner) return;
      const response = await fetch('/api/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: owner.abort.signal,
        body: JSON.stringify({
          endpoint: settings.endpoint.trim(),
          deployment: settings.deployment.trim(),
          auth_mode: settings.auth_mode,
          voice: voiceSettings.realtimeVoice,
          sdp: owner.peer.localDescription.sdp,
          transcribe: true,
          create_response: true,
          instructions: BARISTA_PROMPT,
        }),
      });
      if (voiceSession !== owner) return;
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(
          typeof payload.detail === 'string' ? payload.detail : `音声接続に失敗しました (HTTP ${response.status})。`,
        );
      }
      const sdp = await response.text();
      if (voiceSession !== owner) return;
      await owner.peer.setRemoteDescription({
        type: 'answer',
        sdp,
      });
    } catch (error) {
      if (voiceSession !== owner) return;
      const hints = {
        NotAllowedError: 'マイクへのアクセスが許可されていません。ブラウザーと Windows のマイク設定をご確認ください。',
        NotFoundError: 'マイクが見つかりません。',
        NotReadableError: 'マイクを開けません。他のアプリの利用状況をご確認ください。',
      };
      stopVoice(hints[error.name] || error.message || '音声接続に失敗しました。');
    }
  }
  listen(document.getElementById('voice-toggle'), 'click', startVoice);
  listen(document.getElementById('voice-settings-open'), 'click', openVoiceSettings);
  listen(document.getElementById('voice-mode-choice'), 'change', updateVoiceChoices);
  listen(document.getElementById('voice-settings-form'), 'submit', (event) => {
    event.preventDefault();
    if (voiceSession) return;
    const mode = document.getElementById('voice-mode-choice').value;
    if (mode === 'live_jev' && !voiceModesConfig?.modes?.live_jev?.configured) {
      voiceError(voiceModesConfig?.modes?.live_jev?.detail || 'GPT-Live + Jev の設定を確認できません。', true);
      return;
    }
    try {
      voiceSettings = saveVoicePreferences({ ...voiceSettings, mode,
        [mode === 'live_jev' ? 'liveVoice' : 'realtimeVoice']: document.getElementById('voice-choice').value });
    } catch { voiceError('設定を保存できません。ブラウザーの保存設定をご確認ください。', true); return; }
    liveOrderReview = null;
    document.getElementById('voice-settings').close();
    renderVoice();
  });
  listen(document.getElementById('voice-stop'), 'click', () => {
    if (voiceSession?.mode === 'live_jev') stopVoice();
    else if (voiceSession) interruptVoice(voiceSession);
    else stopHarness();
  });
  listen(document.getElementById('voice-mute'), 'click', () => {
    const owner = voiceSession;
    if (owner?.mode === 'live_jev') { owner.toggleMute(); return; }
    if (!owner?.ready) return;
    owner.muted = !owner.muted;
    owner.stream.getAudioTracks().forEach((track) => {
      track.enabled = !owner.muted;
    });
    if (owner.muted) {
      owner.hearing = false;
      if (owner.activeInput) {
        owner.transcribed.add(owner.activeInput);
        baristaMessage(owner, owner.activeInput, 'user', '（音声入力を中止しました）');
        owner.activeInput = null;
      }
      voiceEvent(owner, {
        type: 'input_audio_buffer.clear',
      });
    }
    renderVoice();
  });
  listen(document.getElementById('voice-resume'), 'click', async () => {
    try {
      await voiceAudio.play();
      document.getElementById('voice-resume').hidden = true;
    } catch {
      voiceError('音声を再生できません。ブラウザーの音声出力設定をご確認ください。');
    }
  });
  listen(window, 'pagehide', () => { stopHarness(); stopVoice('', true); });
  const assistantResizer = document.getElementById('assistant-resize');
  let assistantWidth = 340;
  let assistantDrag = null;
  function assistantWidthLimit() {
    return Math.max(320, Math.min(720, document.documentElement.clientWidth - 640));
  }
  function syncAssistantWidth() {
    const maximum = assistantWidthLimit();
    const width = Math.round(Math.max(320, Math.min(maximum, assistantWidth)));
    document.documentElement.style.setProperty('--assistant-width', `${width}px`);
    assistantResizer.setAttribute('aria-valuemin', '320');
    assistantResizer.setAttribute('aria-valuemax', String(maximum));
    assistantResizer.setAttribute('aria-valuenow', String(width));
    assistantResizer.setAttribute('aria-valuetext', `${width} ピクセル`);
  }
  function setAssistantWidth(width) {
    assistantWidth = Math.max(320, Math.min(assistantWidthLimit(), width));
    syncAssistantWidth();
  }
  function finishAssistantResize() {
    const drag = assistantDrag;
    assistantDrag = null;
    document.body.classList.remove('assistant-resizing');
    if (drag && assistantResizer.hasPointerCapture(drag.pointerId))
      assistantResizer.releasePointerCapture(drag.pointerId);
  }
  listen(assistantResizer, 'pointerdown', (event) => {
    if (event.button !== 0 || !event.isPrimary || window.innerWidth <= 980) return;
    event.preventDefault();
    assistantDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      width: document.getElementById('assistant').getBoundingClientRect().width,
    };
    assistantResizer.setPointerCapture(event.pointerId);
    assistantResizer.focus({
      preventScroll: true,
    });
    document.body.classList.add('assistant-resizing');
  });
  listen(assistantResizer, 'pointermove', (event) => {
    if (assistantDrag?.pointerId === event.pointerId)
      setAssistantWidth(assistantDrag.width + assistantDrag.startX - event.clientX);
  });
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'])
    listen(assistantResizer, event, finishAssistantResize);
  listen(assistantResizer, 'dblclick', () => setAssistantWidth(340));
  listen(assistantResizer, 'keydown', (event) => {
    const current = Number(assistantResizer.getAttribute('aria-valuenow'));
    const step = event.shiftKey ? 40 : 20;
    const widths = {
      ArrowLeft: current + step,
      ArrowRight: current - step,
      Home: 320,
      End: assistantWidthLimit(),
      Enter: 340,
    };
    if (!(event.key in widths)) return;
    event.preventDefault();
    setAssistantWidth(widths[event.key]);
  });
  listen(window, 'resize', () => {
    finishAssistantResize();
    syncAssistantWidth();
  });
  syncAssistantWidth();
  let chatOpener;
  function setChatOpen(open, opener) {
    const panel = document.getElementById('assistant');
    if (open) chatOpener = opener || document.activeElement;
    if (!open) {
      closeChatTrace();
      finishAssistantResize();
      stopVoice();
    }
    panel.hidden = !open;
    document.body.classList.toggle('chat-open', open);
    document
      .querySelectorAll('[aria-controls="assistant"]')
      .forEach((button) => button.setAttribute('aria-expanded', String(open)));
    document
      .querySelector('[data-action="toggle-chat"]')
      .setAttribute('aria-label', `バリスタ監修 豆選びガイド（${open ? '閉じる' : '開く'}）`);
    if (open)
      document.getElementById('chat-input').focus({
        preventScroll: true,
      });
    else if (chatOpener instanceof HTMLElement)
      chatOpener.focus({
        preventScroll: true,
      });
  }
  listen(document, 'click', async (event) => {
    const target = event.target.closest('button, a.brand');
    if (!target) return;
    if (target.matches('a.brand')) {
      event.preventDefault();
      state.category = 'beans';
      state.query = '';
      document.getElementById('search').value = '';
      renderCatalog();
      showView('catalog', true);
      return;
    }
    if (target.dataset.category) {
      state.category = target.dataset.category;
      renderCatalog();
      return;
    }
    if (target.dataset.compare) {
      toggleComparison(target.dataset.compare);
      return;
    }
    if (target.dataset.detail) {
      openDetail(target.dataset.detail);
      return;
    }
    if (target.dataset.add) {
      addToCart(target.dataset.add);
      return;
    }
    if (target.dataset.source) {
      openSource(target.dataset.source);
      return;
    }
    if (target.dataset.reviewLine) {
      openReview(target.dataset.orderId, target.dataset.reviewLine);
      return;
    }
    if (target.dataset.memoryRemove) {
      deletePreferenceMemory(target.dataset.memoryRemove);
      document.querySelector('#memory-dialog [data-action="close-dialog"]').focus();
      return;
    }
    if (target.dataset.prompt) {
      sendChat(target.dataset.prompt);
      return;
    }
    if (target.dataset.detailCompare) {
      const id = target.dataset.detailCompare;
      if (!state.compare.includes(id)) toggleComparison(id);
      document.getElementById('detail-dialog').close();
      showView('compare', true);
      return;
    }
    if (target.dataset.quantity) {
      const id = target.dataset.quantity;
      const next = (state.cart[id] || 0) + Number(target.dataset.delta);
      if (next <= 0) delete state.cart[id];
      else state.cart[id] = Math.min(9, next);
      renderShared();
      renderCart();
      return;
    }
    switch (target.dataset.action) {
      case 'catalog-view':
        showView('catalog', true);
        break;
      case 'compare-view':
        showView('compare', true);
        break;
      case 'all':
        state.category = 'all';
        state.query = '';
        document.getElementById('search').value = '';
        renderCatalog();
        showView('catalog', true);
        break;
      case 'cart':
        openCart();
        break;
      case 'orders':
        showOrder();
        break;
      case 'receive-order':
        target.disabled = true;
        target.setAttribute('aria-busy', 'true');
        try {
          const result = await requestJson(`/api/orders/${encodeURIComponent(target.dataset.orderId)}/receive`, {
            method: 'POST', body: '{}',
          });
          rememberOrder(result.order);
          showOrder(false);
        } catch (error) { toast(error.message || '受取状態を更新できませんでした。'); }
        finally { target.disabled = false; target.removeAttribute('aria-busy'); }
        break;
      case 'edit-review':
        if (reviewDraft) openReview(reviewDraft.orderId, reviewDraft.lineId, true);
        break;
      case 'post-review':
        postReview();
        break;
      case 'faq':
        showView('faq', true);
        break;
      case 'faq-consult':
        setChatOpen(true, document.querySelector('[data-action="toggle-chat"]'));
        break;
      case 'memory-open':
        openMemory();
        break;
      case 'memory-delete':
        document.getElementById('memory-delete-confirm').hidden = false;
        document.querySelector('[data-action="memory-delete-confirm"]').focus();
        break;
      case 'memory-delete-cancel':
        document.getElementById('memory-delete-confirm').hidden = true;
        document.querySelector('[data-action="memory-delete"]').focus();
        break;
      case 'memory-delete-confirm':
        deletePreferenceMemory();
        break;
      case 'close-dialog':
        target.closest('dialog').close();
        break;
      case 'clear-compare': {
        clearStages();
        saveComparisonHistory();
        const removed = [...state.compare];
        state.compare = [];
        renderAfterCompareExit(removed);
        toast('比較をクリアしました', true);
        break;
      }
      case 'undo':
        undoComparison();
        break;
      case 'theme':
        document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        break;
      case 'open-chat':
        setChatOpen(true, target);
        break;
      case 'toggle-chat':
        setChatOpen(document.getElementById('assistant').hidden, target);
        break;
      case 'close-chat':
        setChatOpen(false);
        break;
      case 'checkout': {
        if (!Object.keys(state.cart).length) break;
        if (liveCheckoutPending) break;
        const liveOwner = voiceSession?.mode === 'live_jev' ? voiceSession : null;
        if (liveOwner && liveOrderReview && liveOrderReview !== voiceFingerprint(shopContext())) {
          liveOrderReview = voiceFingerprint(shopContext());
          renderCart();
          toast('注文内容が変わりました。画面を再確認してから確定してください。');
          break;
        }
        if (liveOwner) { liveCheckoutPending = true; liveOwner.screenAction(); }
        target.disabled = true;
        target.setAttribute('aria-busy', 'true');
        try {
          const order = await submitOrder();
          if (liveOwner && voiceSession === liveOwner) liveOwner.confirmedOrder(order);
        } catch (error) {
          toast(error.message || '注文を確定できませんでした。');
        } finally {
          liveCheckoutPending = false;
          target.disabled = false;
          target.removeAttribute('aria-busy');
        }
        break;
      }
    }
  });
  listen(document.getElementById('search'), 'input', (event) => {
    state.query = event.target.value;
    renderCatalog();
  });
  listen(document.querySelector('.view-tabs'), 'keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const view =
      event.key === 'Home'
        ? 'catalog'
        : event.key === 'End'
          ? 'compare'
          : state.view === 'catalog'
            ? 'compare'
            : 'catalog';
    showView(view);
    document.getElementById(view === 'catalog' ? 'catalog-tab' : 'compare-tab').focus();
  });
  listen(document.getElementById('sort'), 'change', (event) => {
    state.sort = event.target.value;
    renderCatalog();
  });
  listen(document.getElementById('store-select'), 'change', (event) => {
    state.store = event.target.value;
    state.storeId = event.target.selectedOptions[0]?.dataset.storeId || '';
    renderShared();
  });
  listen(document.getElementById('time-select'), 'change', (event) => {
    state.time = event.target.value;
    renderShared();
  });
  listen(document.getElementById('compare-view'), 'change', (event) => {
    const field = event.target.dataset.field;
    if (!field || !(field in state.fields)) return;
    clearStages();
    saveComparisonHistory();
    state.fields[field] = event.target.checked;
    renderComparison();
  });
  listen(document.getElementById('chat-form'), 'submit', (event) => {
    event.preventDefault();
    sendChat(document.getElementById('chat-input').value);
  });
  listen(document.getElementById('cart-body'), 'input', (event) => {
    if (
      reviewDraft &&
      event.target.closest('#review-form') &&
      ['productRating', 'productBody', 'serviceRating', 'serviceBody'].includes(event.target.name)
    )
      reviewDraft[event.target.name] = event.target.value;
  });
  listen(document.getElementById('cart-body'), 'submit', (event) => {
    if (event.target.id === 'review-form') {
      event.preventDefault();
      if (event.target.reportValidity()) confirmReview();
    }
  });
  listen(document.getElementById('demo-prompt-select'), 'change', (event) => {
    const key = event.target.value;
    if (!Object.hasOwn(DEMO_PROMPTS, key)) return;
    const input = document.getElementById('chat-input');
    input.value = DEMO_PROMPTS[key];
    fitChatInput();
    input.focus({
      preventScroll: true,
    });
    input.setSelectionRange(0, 0);
    input.scrollTop = 0;
    event.target.value = '';
  });
  listen(document.getElementById('chat-input'), 'input', fitChatInput);
  listen(window, 'storage', (event) => {
    if (event.key === MEMORY_KEY || event.key === null) {
      preferenceMemory = readPreferenceMemory();
      renderMemory();
    }
  });
  listen(document.getElementById('chat-input'), 'keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendChat(event.target.value);
    }
  });
  document.querySelectorAll('dialog').forEach((dialog) =>
    listen(dialog, 'click', (event) => {
      if (event.target === dialog) {
        const bounds = dialog.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        )
          dialog.close();
      }
    }),
  );
  listen(document, 'keydown', (event) => {
    if (
      event.key === 'Escape' &&
      !document.querySelector('dialog[open]') &&
      !document.getElementById('assistant').hidden
    )
      setChatOpen(false);
  });
  listen(window, 'popstate', syncViewFromLocation);
  listen(window, 'hashchange', syncViewFromLocation);
  renderShared();
  renderMemory();
  if (location.hash === '#faq' || location.hash === '#compare') syncViewFromLocation();
  return () => {
    stopHarness();
    stopVoice('', true);
    closeChatTrace();
    finishAssistantResize();
    lifecycle.dispose();
    traceParent.insertBefore(originalTrace, traceNext);
    document.body.classList.remove('chat-open', 'assistant-resizing');
    document.documentElement.style.removeProperty('--assistant-width');
  };
}

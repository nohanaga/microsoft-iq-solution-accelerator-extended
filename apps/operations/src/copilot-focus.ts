import type { UiCommand } from './copilot-ui-command';

/** Data Copilot が操作した領域と、光らせる要素の CSS セレクターです。 */
const focusSelectors = {
  pageHeading: 'main .page-heading, main .dd-heading, main .sd-heading',
  reviewsFilter: '.voice-sources, .voice-filters',
  developmentScenario: '.dd-controls',
  supplyFilter: '.sd-filters',
  ontologyRecord: '.ontology-explorer',
} as const;
export type CopilotFocusRegion = keyof typeof focusSelectors;

const focusClass = 'copilot-focus';
// styles.css の copilot-ring-spin 1.1s × 3 周と一致させます。
const ringDuration = 3300;
const renderWait = 2500;
let running: { elements: Element[]; frame: number; timer: number } | null = null;

export function focusRegion(command: UiCommand): CopilotFocusRegion | undefined {
  switch (command.type) {
    case 'supply.setCase': return 'supplyFilter';
    case 'navigate': return 'pageHeading';
    case 'reviews.setFilter': return 'reviewsFilter';
    case 'development.setScenario': return 'developmentScenario';
    case 'supply.setFilter': return 'supplyFilter';
    case 'ontology.selectRecord': return 'ontologyRecord';
    case 'copilot.openReference': return undefined;
  }
}

function stopHighlight() {
  if (!running) return;
  cancelAnimationFrame(running.frame);
  clearTimeout(running.timer);
  for (const element of running.elements) element.classList.remove(focusClass);
  running = null;
}

/** 操作された領域の枠を回転する光で 3 周ぶん示します。表示だけを変え、画面の状態は変更しません。 */
export function highlightCopilotRegions(regions: CopilotFocusRegion[]) {
  stopHighlight();
  if (!regions.length) return;
  const selector = [...new Set(regions.map(region => focusSelectors[region]))].join(', ');
  const deadline = performance.now() + renderWait;
  const seek = () => {
    const elements = [...document.querySelectorAll(selector)];
    // 画面切替や遅延読み込みの後に現れるため、対象が描画されるまで探します。
    if (!elements.length) {
      if (performance.now() > deadline) { running = null; return; }
      running = { elements: [], frame: requestAnimationFrame(seek), timer: 0 };
      return;
    }
    for (const element of elements) {
      element.classList.remove(focusClass);
      void (element as HTMLElement).offsetWidth; // 同じ領域を続けて操作した時にアニメーションを再生し直します。
      element.classList.add(focusClass);
    }
    running = { elements, frame: 0, timer: window.setTimeout(stopHighlight, ringDuration) };
  };
  running = { elements: [], frame: requestAnimationFrame(seek), timer: 0 };
}

import { t } from '../i18n';
import type {
  ValidationIssue,
  ValidationResult,
} from '../core/nes-validator';

export interface NesValidationPanelOptions {
  readonly result: ValidationResult;
  readonly isCollapsed?: boolean;
  readonly onToggleCollapse?: () => void;
}

export function createNesValidationPanel(
  options: NesValidationPanelOptions,
): HTMLElement {
  const container = document.createElement('div');
  container.className = 'nes-validation-panel-content';

  const metricsGrid = document.createElement('div');
  metricsGrid.className = 'nes-validation-metrics-grid';

  const { metrics, issues, errorCount, warningCount } = options.result;

  // 1. Metric cards
  const palCard = createMetricCard(
    t('validationMetricPalettes'),
    `${String(metrics.spritePalettesUsed)} / ${String(metrics.spritePalettesMax)}`,
    metrics.spritePalettesUsed > metrics.spritePalettesMax
      ? 'error'
      : metrics.spritePalettesUsed === metrics.spritePalettesMax
        ? 'warning'
        : 'ok',
  );

  const chrCard = createMetricCard(
    t('validationMetricChr'),
    `${String(metrics.spriteChrTilesUsed)} / ${String(metrics.spriteChrTilesMax)}`,
    metrics.spriteChrTilesUsed > metrics.spriteChrTilesMax
      ? 'error'
      : metrics.spriteChrTilesUsed >= 240
        ? 'warning'
        : 'ok',
  );

  const oamCard = createMetricCard(
    t('validationMetricOam'),
    `${String(metrics.oamSpritesUsed)} / ${String(metrics.oamSpritesMax)}`,
    metrics.oamSpritesUsed > metrics.oamSpritesMax ? 'error' : 'ok',
  );

  const scanCard = createMetricCard(
    t('validationMetricScanlinePeak'),
    `${String(metrics.peakSpritesPerScanline)} / ${String(metrics.maxSpritesPerScanline)}`,
    metrics.peakSpritesPerScanline > metrics.maxSpritesPerScanline
      ? 'warning'
      : 'ok',
    metrics.peakScanlineIndex !== null
      ? `@ line ${String(metrics.peakScanlineIndex)}`
      : undefined,
  );

  metricsGrid.append(palCard, chrCard, oamCard, scanCard);
  container.append(metricsGrid);

  // 2. Filter & summary bar
  const headerBar = document.createElement('div');
  headerBar.className = 'nes-validation-header-bar';

  const summary = document.createElement('div');
  summary.className = 'nes-validation-summary';

  if (errorCount === 0 && warningCount === 0) {
    const okBadge = document.createElement('span');
    okBadge.className = 'badge badge-success';
    okBadge.textContent = `✓ ${t('validationStatusValid')}`;
    summary.append(okBadge);
  } else {
    if (errorCount > 0) {
      const errBadge = document.createElement('span');
      errBadge.className = 'badge badge-error';
      errBadge.textContent = `${String(errorCount)} ${t(errorCount === 1 ? 'validationErrorSingular' : 'validationErrorPlural')}`;
      summary.append(errBadge);
    }
    if (warningCount > 0) {
      const warnBadge = document.createElement('span');
      warnBadge.className = 'badge badge-warning';
      warnBadge.textContent = `${String(warningCount)} ${t(warningCount === 1 ? 'validationWarningSingular' : 'validationWarningPlural')}`;
      summary.append(warnBadge);
    }
  }

  headerBar.append(summary);
  container.append(headerBar);

  // 3. Issue list
  const listContainer = document.createElement('div');
  listContainer.className = 'nes-validation-issues-list';

  if (issues.length === 0) {
    const emptyMsg = document.createElement('div');
    emptyMsg.className = 'nes-validation-empty-state';
    emptyMsg.textContent = t('validationAllGood');
    listContainer.append(emptyMsg);
  } else {
    for (const issue of issues) {
      const card = createIssueCard(issue);
      listContainer.append(card);
    }
  }

  container.append(listContainer);
  return container;
}

function createMetricCard(
  title: string,
  value: string,
  status: 'ok' | 'warning' | 'error',
  subtitle?: string,
): HTMLElement {
  const card = document.createElement('div');
  card.className = `nes-validation-metric-card status-${status}`;

  const titleEl = document.createElement('span');
  titleEl.className = 'nes-metric-title';
  titleEl.textContent = title;

  const valueEl = document.createElement('span');
  valueEl.className = 'nes-metric-value';
  valueEl.textContent = value;

  card.append(titleEl, valueEl);

  if (subtitle) {
    const subEl = document.createElement('span');
    subEl.className = 'nes-metric-subtitle';
    subEl.textContent = subtitle;
    card.append(subEl);
  }

  return card;
}

function createIssueCard(issue: ValidationIssue): HTMLElement {
  const card = document.createElement('div');
  card.className = `nes-validation-issue-card severity-${issue.severity}`;

  const topRow = document.createElement('div');
  topRow.className = 'nes-issue-top-row';

  const severityBadge = document.createElement('span');
  severityBadge.className = `badge badge-${issue.severity === 'error' ? 'error' : issue.severity === 'warning' ? 'warning' : 'info'}`;
  severityBadge.textContent = issue.severity.toUpperCase();

  const codeEl = document.createElement('code');
  codeEl.className = 'nes-issue-code';
  codeEl.textContent = issue.code;

  const scopeBadge = document.createElement('span');
  scopeBadge.className = 'badge badge-neutral';
  scopeBadge.textContent = issue.scope;

  topRow.append(severityBadge, codeEl, scopeBadge);

  const messageEl = document.createElement('p');
  messageEl.className = 'nes-issue-message';
  messageEl.textContent = issue.message;

  card.append(topRow, messageEl);
  return card;
}

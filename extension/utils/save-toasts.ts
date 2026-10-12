import type { DotI18nApi } from './i18n.ts';
import { ICONS, makeIcon } from './icons.ts';
import { StatusSurface } from './status-surface.ts';
import { userOnly } from './user-gesture.ts';

export const SAVE_TOAST_DURATION_MS = 2000;
const SUCCESS_DURATION_MS = 2000;
export interface SaveNoticeDetails {
  url?: string;
  savedSummary?: string;
}

// 進行・成功は集約し、失敗は確認または再試行するまで残す。
export class SaveToasts {
  private active = new Set<string>();
  private completed = 0;
  private progressCount = 0;
  private progress: StatusSurface | null = null;
  private failures = new Map<string, { target: string; text: string; retry?: () => void; severity: 'error' | 'partial' | 'idle'; details?: SaveNoticeDetails }>();
  private failure: StatusSurface | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private t: DotI18nApi['getMessage']) {}

  clearFailure(id: string) {
    if (this.failures.delete(id)) this.renderFailures();
  }

  begin(id: string) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.active.add(id);
    this.renderProgress();
  }

  end(id: string, success: boolean) {
    if (!this.active.delete(id)) return;
    if (success) this.completed++;
    this.renderProgress();
    if (!this.active.size) this.expire();
  }

  notice(id: string, target: string, text: string, retry?: () => void, severity: 'error' | 'partial' | 'idle' = 'error', details?: SaveNoticeDetails) {
    if (severity === 'idle' || (!details && !retry)) {
      const surface = new StatusSurface({ resting: ICONS.warn, variant: 'toast', role: severity === 'error' ? 'alert' : 'status' });
      surface.el.dataset.dotSaveBanner = '';
      surface.setState(severity, severity === 'error' ? text : undefined);
      this.close(surface, () => surface.remove());
      surface.mount();
      if (severity !== 'error') surface.announce(text);
      surface.enter();
      if (severity === 'idle') setTimeout(() => surface.exit(), SAVE_TOAST_DURATION_MS);
      return;
    }
    this.failures.set(id, { target, text, retry, severity, details });
    this.renderFailures();
  }

  private button(label: string, action: () => void, once = true) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action';
    button.textContent = label;
    button.onclick = userOnly<MouseEvent>((event) => {
      event.preventDefault();
      event.stopPropagation();
      if (button.disabled) return;
      button.disabled = once;
      action();
    });
    return button;
  }

  private close(surface: StatusSurface, action: () => void) {
    const button = this.button(this.t('toastClose'), action);
    button.classList.add('toast-close');
    button.setAttribute('aria-label', this.t('toastClose'));
    button.replaceChildren(makeIcon(ICONS.cross, 14));
    surface.slot(button);
    surface.el.style.pointerEvents = 'auto';
    return button;
  }

  private renderProgress() {
    if (!this.active.size && !this.completed) {
      this.progress?.remove();
      this.progress = null;
      this.progressCount = 0;
      return;
    }
    if (!this.progress) {
      this.progress = new StatusSurface({ resting: ICONS.check, variant: 'toast' });
      this.progress.el.dataset.dotSaveProgress = '';
      this.progress.mount();
      this.progress.enter();
    }
    const text = this.active.size ? this.t('toastProgress', [this.active.size]) : this.t('toastSaved', [this.completed]);
    this.progress.setState(this.active.size ? 'busy' : 'success', text);
    this.progressCount = Math.max(this.progressCount, this.active.size + this.completed);
    const visible = document.createElement('span');
    visible.textContent = text;
    const measures = ['toastProgress', 'toastSaved'].map((key) => {
      const span = document.createElement('span');
      span.className = 'toast-measure';
      span.setAttribute('aria-hidden', 'true');
      span.textContent = this.t(key, [this.progressCount]);
      return span;
    });
    this.progress.label.replaceChildren(visible);
    const content = document.createElement('div');
    content.className = 'toast-progress-content';
    content.append(this.progress.badge, this.progress.label);
    this.progress.el.replaceChildren(...measures, content);
    this.progress.el.style.pointerEvents = 'auto';
  }

  private expire() {
    this.timer = setTimeout(() => {
      if (this.progress?.el.matches(':hover') || this.progress?.el.contains(this.progress.el.getRootNode() instanceof ShadowRoot ? (this.progress.el.getRootNode() as ShadowRoot).activeElement : document.activeElement)) {
        this.expire();
        return;
      }
      this.resetProgress();
    }, SUCCESS_DURATION_MS);
  }

  private resetProgress() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.progress?.exit();
    this.progress = null;
    this.completed = 0;
    this.progressCount = 0;
  }

  private renderFailures() {
    const root = this.failure?.el.getRootNode();
    const focused = root instanceof ShadowRoot ? root.activeElement : document.activeElement;
    const focusKey = focused instanceof HTMLElement && this.failure?.el.contains(focused) ? focused.dataset.toastFocus : undefined;
    this.failure?.remove();
    this.failure = null;
    if (!this.failures.size) return;
    const severity = [...this.failures.values()].some((x) => x.severity === 'error') ? 'error' : ([...this.failures.values()][0]?.severity ?? 'idle');
    const surface = new StatusSurface({ resting: ICONS.warn, variant: 'toast', role: severity === 'error' ? 'alert' : 'status' });
    this.failure = surface;
    surface.el.dataset.dotSaveBanner = '';
    const entries = [...this.failures.values()];
    const text = entries.length === 1 && entries[0] ? entries[0].text : this.t('toastFailed', [entries.length]);
    surface.setState(severity, severity === 'error' ? text : undefined);
    surface.el.dataset.dotSaveFailures = '';
    surface.el.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      this.failures.clear();
      this.renderFailures();
    });
    const list = document.createElement('div');
    list.className = 'toast-failures';
    for (const [id, entry] of this.failures) {
      const row = document.createElement('div');
      row.className = 'toast-failure';
      if (entries.length > 1) {
        const reason = document.createElement('div');
        reason.textContent = entry.text;
        row.appendChild(reason);
      }
      if (entry.details?.savedSummary && entry.details.savedSummary !== entry.text) {
        const summary = document.createElement('div');
        summary.className = 'toast-target';
        summary.textContent = entry.details.savedSummary;
        row.appendChild(summary);
      }
      const rowActions = document.createElement('div');
      rowActions.className = 'toast-failure-actions';
      if (entry.details?.url && /^https?:\/\//i.test(entry.details.url)) {
        const link = document.createElement('a');
        link.href = entry.details.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = this.t('toastOpenOriginal');
        link.dataset.toastFocus = `original:${id}`;
        rowActions.appendChild(link);
      }
      if (entry.retry) {
        const retry = this.button(this.t('toastRetry'), () => {
          this.failures.delete(id);
          this.renderFailures();
          entry.retry?.();
        });
        retry.dataset.toastFocus = `retry:${id}`;
        rowActions.prepend(retry);
      }
      if (rowActions.childElementCount) row.appendChild(rowActions);
      list.appendChild(row);
    }
    const close = this.close(surface, () => {
      this.failures.clear();
      this.renderFailures();
    });
    close.dataset.toastFocus = 'dismiss';
    const content = document.createElement('div');
    content.className = 'toast-failure-content';
    content.append(list);
    surface.slot(content);
    content.prepend(close);
    surface.mount();
    if (focusKey) {
      const controls = [...surface.el.querySelectorAll<HTMLElement>('[data-toast-focus]')];
      const replacement = controls.find((control) => control.dataset.toastFocus === focusKey);
      (replacement ?? close).focus({ preventScroll: true });
    }
    if (severity !== 'error') surface.announce(text);
    surface.enter();
  }
}

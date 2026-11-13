import {parseYaml} from "obsidian";

export const PROGRESS_LANGUAGE = "agentic-progress";
export interface ProgressData {
  label: string; current: number; total: number; unit: string; percent: number; fill: number;
}

/** Validate presentation data only; these values are not knowledge-base receipts. */
export function parseProgressData(input: unknown): ProgressData | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const data = input as Record<string, unknown>;
  if (Object.keys(data).some(key => !["label", "current", "total", "unit"].includes(key))) return null;
  const {current,total,label,unit} = data;
  if (typeof current !== "number" || typeof total !== "number" ||
      !Number.isFinite(current) || !Number.isFinite(total) || current < 0 || total <= 0 ||
      current > Number.MAX_SAFE_INTEGER || total > Number.MAX_SAFE_INTEGER) return null;
  if (label !== undefined && (typeof label !== "string" || label.length > 200)) return null;
  if (unit !== undefined && (typeof unit !== "string" || unit.length > 40)) return null;
  const rawPercent = current / total * 100;
  if (!Number.isFinite(rawPercent) || rawPercent > Number.MAX_SAFE_INTEGER / 10) return null;
  const percent = Math.round(rawPercent * 10) / 10;
  return {current,total,label:typeof label === "string" && label.trim() ? label.trim() : "进度",
    unit:typeof unit === "string" ? unit.trim() : "",percent,fill:Math.min(100,percent)};
}

/** All markup is created locally; never interpret model-provided HTML or JS. */
export function renderProgressBlock(source: string, el: HTMLElement): void {
  el.empty();
  let value: ProgressData | null = null;
  try { if (source.length <= 2000) value = parseProgressData(parseYaml(source)); } catch { /* Invalid YAML falls back to text. */ }
  if (!value) {
    el.createDiv({cls:"agentic-progress-error",text:"无法显示进度：需要有效的完成数（≥0）和目标数（>0），标签和单位只能是文字。",attr:{role:"status"}});
    return;
  }
  const {label,current,total,unit,percent,fill} = value;
  const root = el.createDiv({cls:"agentic-progress"});
  root.createDiv({cls:"agentic-progress-label",text:label});
  const summary = `${current} / ${total}${unit ? " " + unit : ""} · ${percent}%`;
  root.createDiv({cls:"agentic-progress-summary",text:summary});
  const meter = root.createEl("progress",{cls:"agentic-progress-meter",attr:{max:"100",value:String(fill),"aria-label":label,"aria-valuetext":summary}});
  meter.textContent = `${percent}%`;
}

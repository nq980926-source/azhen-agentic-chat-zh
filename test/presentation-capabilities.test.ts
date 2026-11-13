import {afterEach, describe, expect, it} from "vitest";
import {MarkdownPreviewRenderer, type App} from "obsidian";
import {readPresentationCapabilities, presentationOverlay} from "../src/agent/presentation-capabilities";
import {composeAgentSystemPrompt, EMPTY_AGENT_RUNTIME_RESOURCES} from "../src/agent/runtime-resources";
import {DEFAULT_SETTINGS} from "../src/settings";

const registry = MarkdownPreviewRenderer as unknown as {codeBlockPostProcessors: unknown};
const handler = () => {};
function app(enabled = true, loaded = true): App {
  return {plugins: {enabledPlugins: new Set(enabled ? ["obsidian-charts"] : []), plugins: {"obsidian-charts": {_loaded: loaded}}}} as unknown as App;
}
afterEach(() => {registry.codeBlockPostProcessors = undefined;});
describe("presentation capability contract", () => {
  it("requires enabled, loaded Charts and real registered functions", () => {
    registry.codeBlockPostProcessors = {chart: handler, "advanced-chart": handler};
    expect(readPresentationCapabilities(app())).toEqual({chart: true, advancedChart: true});
    expect(readPresentationCapabilities(app(false))).toEqual({chart: false, advancedChart: false});
    expect(readPresentationCapabilities(app(true, false))).toEqual({chart: false, advancedChart: false});
    expect(readPresentationCapabilities({} as App)).toEqual({chart: false, advancedChart: false});
  });
  it("does not mistake installation metadata, an unknown registry, inherited keys or a partial handler for full support", () => {
    for (const value of [undefined, null, [], "chart", {chart: {}}, Object.create({chart: handler})]) {
      registry.codeBlockPostProcessors = value;
      expect(readPresentationCapabilities(app())).toEqual({chart: false, advancedChart: false});
    }
    registry.codeBlockPostProcessors = {chart: handler};
    expect(readPresentationCapabilities(app())).toEqual({chart: true, advancedChart: false});
    expect(presentationOverlay(readPresentationCapabilities(app()))).not.toContain("```advanced-chart");
    registry.codeBlockPostProcessors = {"advanced-chart": handler};
    expect(readPresentationCapabilities(app())).toEqual({chart: false, advancedChart: true});
    expect(presentationOverlay(readPresentationCapabilities(app()))).not.toContain("```chart");
  });
  it("fails closed if host introspection throws", () => {
    const throwing = Object.defineProperty({}, "plugins", {get() {throw Error("unavailable");}});
    expect(readPresentationCapabilities(throwing as App)).toEqual({chart: false, advancedChart: false});
  });
  it("keeps all capability combinations bounded and unsupported components unadvertised", () => {
    for(const chart of [false, true]) for(const advancedChart of [false, true]) {
      const text = presentationOverlay({chart, advancedChart});
      expect(text.length).toBeLessThanOrEqual(2600);
      expect(text).toContain("No native progress/card components or calendar heatmap are advertised");
      expect(text).toContain("Missing dates are not zero");
      expect(text).toContain("FinanceFact-derived");
      if(!chart && !advancedChart) {
        expect(text).toContain("Charts rendering is unavailable or unconfirmed");
        expect(text).not.toContain("```chart");
        expect(text).not.toContain("```advanced-chart");
      }
    }
  });
  it("uses the existing Charts inline protocols, preserving user, Memory, date and Skill context", () => {
    const overlay = presentationOverlay({chart: true, advancedChart: true});
    const json = JSON.parse(/```advanced-chart\n([^`]+)\n```/.exec(overlay)![1]);
    expect(json.type).toBe("bar");expect(json.data.datasets[0].data).toEqual([1,2]);
    expect(json.options.scales.y.beginAtZero).toBe(true);
    const resources = {...EMPTY_AGENT_RUNTIME_RESOURCES, skills: [{name:"Demo",description:"skill sentinel",content:"body",filePath:"demo.md"}]};
    const prompt = composeAgentSystemPrompt({...DEFAULT_SETTINGS,systemPrompt:"Custom sentinel"}, resources,"Identity sentinel",undefined,"Memory sentinel","Date sentinel",overlay);
    expect(prompt.startsWith("Custom sentinel")).toBe(true);
    for(const sentinel of ["Identity sentinel","Memory sentinel","Date sentinel","skill sentinel",overlay]) expect(prompt).toContain(sentinel);
    expect(prompt.match(/## Available presentation capabilities/g)).toHaveLength(1);
  });
});

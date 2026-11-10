import { config as base } from "./wdio.conf.mts";
import { env } from "node:process";

export const config: WebdriverIO.Config = {
  ...base,
  specs: ["./test/e2e/specs/finance-charts.e2e.ts"],
  exclude: [],
  capabilities: base.capabilities?.map((capability) => ({
    ...capability,
    "wdio:obsidianOptions": {
      ...(capability["wdio:obsidianOptions"] ?? {}),
      plugins: [
        ".",
        env.AGENTIC_CHAT_CHARTS_PLUGIN
          ? { path: env.AGENTIC_CHAT_CHARTS_PLUGIN }
          : { repo: "phibr0/obsidian-charts" },
      ],
    },
  })) ?? [],
};

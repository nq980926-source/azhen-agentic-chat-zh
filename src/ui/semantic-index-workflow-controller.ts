import type { DataAdapter } from "obsidian";
import { t } from "../i18n";
import {
  bootstrapSemanticIndex,
  readSemanticIndexFile,
  semanticIndexLeases,
  type SemanticIndexFile,
} from "../retrieval/semantic-index";
import {
  estimateEmbeddingIndexCost,
  formatRetrievalIndexStatus,
  type EmbeddingIndexCostEstimate,
  type RetrievalDocument,
  type RetrievalEmbedder,
  type RetrievalIndexScope,
} from "../retrieval/policy";
import { embeddingProfileFromConfig } from "../retrieval/embeddings";
import { parseSemanticIndexScopeCommand } from "./semantic-index-command";
import type { WorkflowRenderer } from "./workflow-renderer";

export interface SemanticIndexWorkflowControllerOptions {
  adapter: DataAdapter;
  indexPath: () => string;
  activeNotePath: () => string | null;
  loadDocuments: (scopeFolders?: readonly string[]) => Promise<RetrievalDocument[]>;
  embeddingConfig: () => Parameters<typeof embeddingProfileFromConfig>[0];
  embeddingsEnabled: () => boolean;
  activeEmbeddingModel: () => string | undefined;
  batchSize: () => number;
  createEmbedder: () => RetrievalEmbedder;
  renderer: WorkflowRenderer;
}

export class SemanticIndexWorkflowController {
  private abort: AbortController | null = null;

  constructor(private readonly options: SemanticIndexWorkflowControllerOptions) {}

  async run(arg: string): Promise<void> {
    this.options.renderer.clear();
    const [subcommand = "status", ...rest] = arg.trim().split(/\s+/).filter(Boolean);
    const action = subcommand.toLowerCase();
    if (action === "status") {
      await this.showStatus();
      return;
    }
    if (action === "cancel") {
      this.cancel();
      return;
    }
    if (action !== "estimate" && action !== "start") {
      this.options.renderer.error(t("semantic.usage"));
      return;
    }

    const parsed = parseSemanticIndexScopeCommand(rest, {
      activeNotePath: this.options.activeNotePath(),
    });
    if ("error" in parsed) {
      this.options.renderer.error(parsed.error);
      return;
    }
    if (action === "start" && parsed.scope.kind === "vault" && !parsed.confirmVault) {
      this.options.renderer.error(t("semantic.confirmVault"));
      return;
    }
    if (action === "start" && this.abort) {
      this.options.renderer.error(t("semantic.alreadyRunning"));
      return;
    }

    // Expose cancel before document preparation: loading a vault scope can take
    // long enough that the user must be able to stop it.
    const controller = action === "start" ? new AbortController() : null;
    if (controller) this.abort = controller;
    try {
      const { documents, estimate } = await this.prepare(parsed.scope);
      if (controller?.signal.aborted) return;
      if (action === "estimate") {
        this.options.renderer.info(t("semantic.estimateTitle"), semanticEstimateRows(parsed.scope, documents, estimate));
        return;
      }
      if (!controller) return;
      await this.start(parsed.scope, documents, estimate, controller);
    } finally {
      if (controller && this.abort === controller) this.abort = null;
    }
  }

  async showStatus(): Promise<void> {
    const file = await readSemanticIndexFile(this.options.adapter, this.options.indexPath());
    if (!file) {
      this.options.renderer.info(t("semantic.title"), [[t("semantic.status"), t("semantic.none")]]);
      return;
    }
    this.options.renderer.info(t("semantic.title"), semanticIndexRows(file));
  }

  cancel(): void {
    if (!this.abort) {
      this.options.renderer.info(t("semantic.title"), [[t("semantic.cancel"), t("semantic.noRun")]]);
      return;
    }
    this.abort.abort();
    this.options.renderer.info(t("semantic.title"), [[t("semantic.cancel"), t("semantic.cancelRequested")]]);
  }

  /** Abort a running index without a user-facing message. The owning view is gone. */
  dispose(): void {
    this.abort?.abort();
    this.abort = null;
  }

  private async prepare(scope: RetrievalIndexScope): Promise<{
    documents: RetrievalDocument[];
    estimate: EmbeddingIndexCostEstimate;
  }> {
    const documents = await this.loadScopedDocuments(scope);
    const profile = embeddingProfileFromConfig(this.options.embeddingConfig());
    return {
      documents,
      estimate: estimateEmbeddingIndexCost({
        scope,
        model: profile,
        documentCount: documents.length,
        characterCount: documents.reduce((sum, document) => sum + document.content.length, 0),
        indexingBatchSize: this.options.batchSize(),
      }),
    };
  }

  private async loadScopedDocuments(scope: RetrievalIndexScope): Promise<RetrievalDocument[]> {
    const scopeFolders = scope.kind === "folder" ? scope.paths : undefined;
    const documents = await this.options.loadDocuments(scopeFolders);
    if (scope.kind !== "tag") return documents;
    const tags = new Set((scope.tags ?? []).map((tag) => tag.replace(/^#/, "").toLowerCase()));
    return documents.filter((document) => (document.tags ?? []).some((tag) => tags.has(tag.toLowerCase().replace(/^#/, ""))));
  }

  private async start(
    scope: RetrievalIndexScope,
    documents: RetrievalDocument[],
    estimate: EmbeddingIndexCostEstimate,
    controller: AbortController,
  ): Promise<void> {
    if (controller.signal.aborted) return;
    if (!this.options.embeddingsEnabled()) {
      this.options.renderer.error(t("semantic.enable"));
      return;
    }
    if (!this.options.activeEmbeddingModel()) {
      this.options.renderer.error(t("semantic.model"));
      return;
    }
    const path = this.options.indexPath();
    let lease;
    try {
      lease = await semanticIndexLeases.acquireDurable(path);
    } catch (error) {
      this.options.renderer.error(error instanceof Error ? error.message : String(error));
      return;
    }
    if (!lease) {
      this.options.renderer.error(
        t("semantic.otherTab"),
      );
      return;
    }
    try {
      this.options.renderer.info(t("semantic.title"), [
        [t("semantic.start"), t("semantic.indexing", { count: documents.length, kind: scope.kind, label: scope.label })],
      ]);
      const result = await bootstrapSemanticIndex({
        adapter: this.options.adapter,
        path,
        scope,
        documents,
        estimate,
        embedder: this.options.createEmbedder(),
        batchSize: this.options.batchSize(),
        signal: controller.signal,
        isLeaseOwned: () => lease.isOwned(),
        onProgress: () => lease.touch(),
      });
      this.options.renderer.info(t("semantic.title"), semanticIndexRows(result.file));
    } finally {
      if (this.abort === controller) this.abort = null;
      await lease.release();
    }
  }
}

export function semanticEstimateRows(
  scope: RetrievalIndexScope,
  documents: readonly RetrievalDocument[],
  estimate: EmbeddingIndexCostEstimate,
): Array<[string, string]> {
  return [
    [t("semantic.scope"), `${scope.kind} "${scope.label}"`],
    [t("semantic.documents"), String(documents.length)],
    [t("semantic.estimatedTokens"), String(estimate.estimatedTokens)],
    [t("semantic.batches"), String(estimate.estimatedBatches)],
    [t("semantic.estimatedCost"), estimate.estimatedCostUsd === undefined ? t("semantic.localUnknown") : `$${estimate.estimatedCostUsd}`],
    [t("semantic.network"), t(estimate.requiresNetwork ? "semantic.yes" : "semantic.no")],
    [t("semantic.warnings"), estimate.warnings.length ? estimate.warnings.join(" ") : t("semantic.noneValue")],
  ];
}

export function semanticIndexRows(file: SemanticIndexFile): Array<[string, string]> {
  const rows: Array<[string, string]> = [
    [t("semantic.status"), formatRetrievalIndexStatus(file.state.status)],
    [t("semantic.updated"), new Date(file.updatedAt).toISOString()],
    [t("semantic.indexedDocuments"), String(file.state.indexedDocumentIds.length)],
  ];
  if (file.snapshot) {
    rows.push([t("semantic.modelLabel"), file.snapshot.model.id]);
    rows.push([t("semantic.dimensions"), String(file.snapshot.model.dimensions)]);
    rows.push([t("semantic.indexRecords"), String(file.snapshot.records.length)]);
  }
  if (file.state.estimate) {
    rows.push([t("semantic.estimatedTokens"), String(file.state.estimate.estimatedTokens)]);
    if (file.state.estimate.estimatedCostUsd !== undefined) {
      rows.push([t("semantic.estimatedCost"), `$${file.state.estimate.estimatedCostUsd}`]);
    }
  }
  return rows;
}

# Local knowledge mode

Entry points: Agent settings knowledge mode selector; all parent/child Vault tools;
MCP registration and invocation; finance query; Web fetch; Skill read/load; existing
settings migration; every chat leaf and background tab.

Witness: test/local-knowledge.test.ts (run failing on c071cd7 before implementation).
Proof will include isolation, atomic updates, read conflicts, fresh reads, path and
trash safety, migration, multi-tab transition and Memory/Web regression.
Status: implementation in progress; Android device acceptance pending.

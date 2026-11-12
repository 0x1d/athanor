## Guidelines

- use and update CONTEXT.md to build a mental map of the project and it's domain language
- git: branch per change, conventional commits, no HTML in Git messages
- planning: decompose complex tasks into a dependency graph and vertical slices; specify the change as a sub-document marked **Planned** in docs/<component>/design/ and declare it under `planned` in that document's front matter (id, title, depends, done), following the [Formulary standard](https://github.com/0x1d/formulary)
- code: use tech stack docs to following best practices; before implementing UI or server behavior, fetch and read the stack **`llms.txt`** indexes (linked below) and follow the linked guides for the components and APIs you use; continuous refactoring during implementation where it makes sense to improve code quality, while working on a feature; update corresponding plan to track progress in docs/internal/plans/<PLAN_ID>_<FEATURE_NAME>.md
- docs: follow the Formulary standard (one document per type, id equals path, relations in front matter); clean and concise wording, mermaid diagrams, progressive disclosure; after finishing a feature, remove its Planned marker and front matter entry and rewrite the document descriptively

## Tech Stack

- bun (fullstack toolkit) — https://bun.sh/llms.txt
- nsh (UI framework) — https://nsh.dev/llms.txt

The IDE shell is NSH TSX (`App.tsx`, `nsh/base` components such as `DockArea`, `Editor`, `Tabs`, chat-style agent UI). The Bun server exposes `/api/*` and a React sandbox at `/preview` for hot-mounted user modules.

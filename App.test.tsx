import { expect, open, test } from "nsh/test";

const network = {
  "GET http://127.0.0.1:43123/api/config": { body: { backend: "memory" } },
  "GET http://127.0.0.1:43123/api/storage?tree=1": { body: { backend: "memory", tree: [] } },
  "GET http://127.0.0.1:43123/api/storage?path=components%2Fwelcome.nsh.tsx": {
    body: { content: "export function Welcome() { return null }\n" },
  },
  "GET http://127.0.0.1:43123/api/services": { body: { configured: false, services: [] } },
  "POST http://127.0.0.1:43123/api/service-tokens": { body: { token: null, slugs: [] } },
  "GET http://127.0.0.1:43123/api/agents": {
    body: {
      agents: [
        { id: "architect", name: "Architect", role: "Plans modules", accent: "" },
        { id: "implementer", name: "Implementer", role: "Writes modules", accent: "" },
        { id: "reviewer", name: "Reviewer", role: "Reviews modules", accent: "" },
      ],
    },
  },
};

test("shows the nshde shell", async () => {
  const app = await open("./App.tsx", { network });
  expect(app.texts().join(" ")).toMatch(/nshde/);
});

test("agents sit on the left, the explorer on the right, and a collapsed pane leaves its rail", async () => {
  const app = await open("./App.tsx", { width: 1280, height: 800, platform: "web", network });
  const text = () => app.texts().join("\n");

  expect(text()).toMatch(/New agent/);
  expect(text()).toMatch(/How can I help/);
  expect(text()).toMatch(/Sessions/);
  expect(text()).toMatch(/Explorer/);
  expect(text()).toMatch(/No components yet/);
  expect(app.shows("Agents")).toBe(true);
  expect(app.shows("Expand runtime")).toBe(false);
  expect(app.shows("Show editor")).toBe(false);
  expect(app.shows("Back to sessions")).toBe(false);

  await app.press("Collapse runtime");
  expect(app.shows("Expand runtime")).toBe(true);
  expect(text()).toMatch(/Runtime/);
  expect(text()).toMatch(/How can I help/);

  await app.press("Expand runtime");
  expect(app.shows("Expand runtime")).toBe(false);

  await app.press("Toggle agents");
  expect(text()).not.toMatch(/How can I help/);
  expect(app.shows("Agents")).toBe(true);
  expect(text()).toMatch(/No components yet/);

  await app.press("Agents");
  expect(text()).toMatch(/How can I help/);

  await app.press("Toggle explorer");
  expect(text()).not.toMatch(/No components yet/);
  expect(app.shows("Explorer")).toBe(true);

  await app.press("Explorer");
  expect(text()).toMatch(/No components yet/);

  await app.press("New agent");
  expect(text()).toMatch(/New agent/);
});

test("opens an explorer file as a closable editor tab", async () => {
  const app = await open("./App.tsx", {
    width: 1280,
    height: 800,
    platform: "web",
    network: {
      ...network,
      "GET http://127.0.0.1:43123/api/storage?tree=1": {
        body: {
          backend: "memory",
          tree: [
            {
              path: "components",
              name: "components",
              kind: "directory",
              children: [
                { path: "components/welcome.nsh.tsx", name: "welcome.nsh.tsx", kind: "file" },
                { path: "components/todo.nsh.tsx", name: "todo.nsh.tsx", kind: "file" },
              ],
            },
          ],
        },
      },
      "GET http://127.0.0.1:43123/api/storage?path=components%2Ftodo.nsh.tsx": {
        body: { content: "export function Todo() { return null }\n" },
      },
    },
  });
  await app.press("todo.nsh.tsx");
  const text = app.texts().join("\n");
  expect(text).toMatch(/components\/todo\.nsh\.tsx/);
  expect(app.shows("Close todo.nsh.tsx")).toBe(true);
  expect(app.shows("Save file")).toBe(true);
});

test("the editor keeps what you type", async () => {
  const app = await open("./App.tsx", { width: 1280, height: 800, platform: "web", network });
  await app.type("components/welcome.nsh.tsx", "stay");
  expect(app.texts().join("\n")).toMatch(/stay/);
});

const phone = { width: 390, height: 844, platform: "web" as const, network };

test("a phone keeps one section on screen and can leave it", async () => {
  const app = await open("./App.tsx", phone);
  const text = () => app.texts().join("\n");

  expect(app.shows("Show editor")).toBe(true);
  expect(app.shows("Toggle agents")).toBe(false);
  expect(app.shows("Expand runtime")).toBe(false);
  expect(text()).not.toMatch(/How can I help/);
  expect(text()).toMatch(/welcome\.nsh\.tsx/);

  await app.type("components/welcome.nsh.tsx", "stay");
  expect(text()).toMatch(/stay/);

  await app.press("Show agents");
  expect(text()).not.toMatch(/How can I help/);
  expect(app.shows("New agent")).toBe(true);
  expect(text()).toMatch(/Sessions/);

  await app.press("Open New agent");
  expect(text()).toMatch(/How can I help/);
  await app.press("Agent role");
  await app.press("Architect");
  expect(app.texts().join(" ")).toMatch(/Architect/);
  await app.press("Back to sessions");
  expect(text()).not.toMatch(/How can I help/);

  await app.press("Show editor");
  expect(text()).toMatch(/stay/);
  expect(text()).not.toMatch(/How can I help/);

  await app.press("Show explorer");
  expect(text()).toMatch(/Explorer/);
  expect(text()).toMatch(/No components yet/);
  await app.press("Show runtime");
  expect(app.shows("Runtime module preview")).toBe(true);
  expect(app.shows("No components yet")).toBe(false);
  await app.press("Show editor");
  expect(app.shows("Runtime module preview")).toBe(false);

  await app.press("Settings");
  expect(app.shows("File storage backend")).toBe(true);
  await app.press("Close Settings");
  expect(app.shows("File storage backend")).toBe(false);
  expect(text()).toMatch(/welcome\.nsh\.tsx/);
});

test("a phone opens an explorer file and closes its tab", async () => {
  const app = await open("./App.tsx", {
    ...phone,
    network: {
      ...network,
      "GET http://127.0.0.1:43123/api/storage?tree=1": {
        body: {
          backend: "memory",
          tree: [
            {
              path: "components",
              name: "components",
              kind: "directory",
              children: [
                { path: "components/welcome.nsh.tsx", name: "welcome.nsh.tsx", kind: "file" },
                { path: "components/todo.nsh.tsx", name: "todo.nsh.tsx", kind: "file" },
              ],
            },
          ],
        },
      },
      "GET http://127.0.0.1:43123/api/storage?path=components%2Ftodo.nsh.tsx": {
        body: { content: "export function Todo() { return null }\n" },
      },
    },
  });

  await app.press("Show explorer");
  await app.press("Mount at runtime");
  expect(app.shows("Runtime module preview")).toBe(true);
  expect(app.shows("Explorer")).toBe(false);
  expect(app.texts().join("\n")).toMatch(/components\/todo\.nsh\.tsx/);
  await app.press("Show explorer");
  await app.press("todo.nsh.tsx");
  expect(app.texts().join("\n")).toMatch(/components\/todo\.nsh\.tsx/);
  expect(app.shows("No components yet")).toBe(false);
  expect(app.shows("Close todo.nsh.tsx")).toBe(true);

  await app.press("Close todo.nsh.tsx");
  expect(app.shows("Close todo.nsh.tsx")).toBe(false);
  expect(app.texts().join("\n")).toMatch(/welcome\.nsh\.tsx/);

  await app.press("Close welcome.nsh.tsx");
  expect(app.shows("Browse files")).toBe(true);
  await app.press("Browse files");
  expect(app.texts().join("\n")).toMatch(/todo\.nsh\.tsx/);
  await app.press("todo.nsh.tsx");
  expect(app.texts().join("\n")).toMatch(/components\/todo\.nsh\.tsx/);
});

test("the agent role menu updates the selected role", async () => {
  const app = await open("./App.tsx", { width: 1280, height: 800, platform: "web", network });
  expect(app.texts().join(" ")).toMatch(/Implementer/);
  await app.press("Agent role");
  await app.press("Architect");
  expect(app.texts().join(" ")).toMatch(/Architect/);
  expect(app.texts().join(" ")).not.toMatch(/Implementer/);
});

test("the explorer lists services with a publish action", async () => {
  const app = await open("./App.tsx", {
    width: 1280,
    height: 800,
    platform: "web",
    network: {
      ...network,
      "GET http://127.0.0.1:43123/api/services": {
        body: {
          configured: true,
          services: [
            { slug: "greeting", summary: "Greet", sourceSha256: "a", valid: true, published: false, stale: false },
            { slug: "weather", summary: "", sourceSha256: "b", valid: true, published: true, stale: true },
          ],
        },
      },
    },
  });
  const text = app.texts().join("\n");
  expect(text).toMatch(/services/);
  expect(text).toMatch(/greeting/);
  expect(text).toMatch(/changed/);
  expect(app.shows("Publish greeting")).toBe(true);
  expect(app.shows("Publish weather")).toBe(true);
});

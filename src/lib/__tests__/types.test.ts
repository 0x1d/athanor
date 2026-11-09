import { expect, test } from "bun:test";
import { schemaToType, serviceDeclarations } from "@/lib/services/types";

test("maps JSON Schema to TypeScript", () => {
  expect(
    schemaToType({
      type: "object",
      required: ["name"],
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        count: { type: "integer" },
        tags: { type: "array", items: { type: "string" } },
        mode: { enum: ["a", "b"] },
        "x-id": { type: ["string", "null"] },
      },
    }),
  ).toBe(`{
  name: string;
  count?: number;
  tags?: Array<string>;
  mode?: "a" | "b";
  "x-id"?: string | null;
}`);
  expect(schemaToType(true)).toBe("unknown");
  expect(schemaToType({ type: "object" })).toBe("{\n  [key: string]: unknown;\n}");
  expect(schemaToType({ anyOf: [{ type: "string" }, { type: "number" }] })).toBe("string | number");
});

test("declares @nshde/services for services with schemas", () => {
  const text = serviceDeclarations([
    {
      slug: "greeting",
      summary: "",
      sourceSha256: "x",
      valid: true,
      published: true,
      stale: false,
      inputSchema: { type: "object", required: ["name"], properties: { name: { type: "string" } } },
      outputSchema: { type: "object", required: ["message"], properties: { message: { type: "string" } } },
    },
    { slug: "draft", summary: "", sourceSha256: "y", valid: false, published: false, stale: false },
  ]);
  expect(text).toContain('declare module "@nshde/services"');
  expect(text).toContain('"greeting": {');
  expect(text).toContain("name: string;");
  expect(text).not.toContain('"draft"');
});

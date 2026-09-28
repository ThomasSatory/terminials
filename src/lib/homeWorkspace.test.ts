import { describe, expect, it } from "vitest";
import { homeWorkspaceName } from "./homeWorkspace";

describe("homeWorkspaceName", () => {
  it("prend « ~ » tant qu'il est libre", () => {
    expect(homeWorkspaceName([])).toBe("~");
    expect(homeWorkspaceName(["app", "~ 2"])).toBe("~");
  });

  it("numérote à partir de 2 quand « ~ » existe", () => {
    expect(homeWorkspaceName(["~"])).toBe("~ 2");
    expect(homeWorkspaceName(["~", "~ 2"])).toBe("~ 3");
  });
});

import { describe, expect, it } from "vitest";
import { isClaudeSessionId, keepExistingSessions, parseClaudeSession, resumeCommand } from "./claudeResume";

const SID = "6db82e10-f79a-44eb-a88f-8737db058caf";

describe("claudeResume", () => {
  it("n'accepte qu'un UUID comme id de session", () => {
    expect(isClaudeSessionId(SID)).toBe(true);
    expect(isClaudeSessionId(SID.toUpperCase())).toBe(true);
    expect(isClaudeSessionId(`${SID}; rm -rf ~`)).toBe(false);
    expect(isClaudeSessionId("$(id)")).toBe(false);
    expect(isClaudeSessionId(42)).toBe(false);
  });

  it("parseClaudeSession exige un id valide et un dossier", () => {
    expect(parseClaudeSession({ id: SID, cwd: "/a" })).toEqual({ id: SID, cwd: "/a" });
    expect(parseClaudeSession({ id: SID, cwd: "" })).toBeNull();
    expect(parseClaudeSession({ id: "abc", cwd: "/a" })).toBeNull();
    expect(parseClaudeSession(null)).toBeNull();
  });

  it("resumeCommand tape la reprise, rien pour un id invalide", () => {
    expect(resumeCommand(SID)).toBe(`claude --resume ${SID}\r`);
    expect(resumeCommand("x && y")).toBeNull();
  });

  it("keepExistingSessions retire les sessions dont le dossier a disparu", async () => {
    const exists = async (p: string) => p === "/a";
    const entry = { cwd: "/a", claudeSessions: [{ id: SID, cwd: "/a" }, { id: SID, cwd: "/gone" }, null] };
    expect((await keepExistingSessions(entry, exists)).claudeSessions).toEqual([{ id: SID, cwd: "/a" }, null, null]);
    const gone = { cwd: "/a", claudeSessions: [{ id: SID, cwd: "/gone" }] };
    expect(await keepExistingSessions(gone, exists)).toEqual({ cwd: "/a" });
    const none: { cwd: string; claudeSessions?: null[] } = { cwd: "/a" };
    expect(await keepExistingSessions(none, exists)).toEqual({ cwd: "/a" });
  });
});

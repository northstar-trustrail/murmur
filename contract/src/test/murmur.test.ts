// SPDX-License-Identifier: Apache-2.0
import { beforeEach, describe, expect, it } from "vitest";
import { Status } from "../managed/murmur/contract/index.js";
import { witnesses } from "../witnesses.js";
import { type Actor, MurmurSimulator, memberLeaf, newMember, newOperator, operatorKey, randomBytes } from "../simulator.js";

const SITE_DEPOT = 2;
const SITE_HQ = 1;
const ROLE_DRIVER = 3;
const ROLE_MANAGER = 7;
const hash = () => randomBytes(32);
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

let sim: MurmurSimulator;
let op: Actor;
let ana: Actor; // depot driver
let ben: Actor; // depot driver
let cai: Actor; // HQ manager

beforeEach(async () => {
  op = newOperator("operator");
  sim = await MurmurSimulator.deploy(op, "Example Logistics (synthetic)");
  ana = newMember("ana", SITE_DEPOT, ROLE_DRIVER);
  ben = newMember("ben", SITE_DEPOT, ROLE_DRIVER);
  cai = newMember("cai", SITE_HQ, ROLE_MANAGER);
  for (const m of [ana, ben, cai]) await sim.enroll(op, memberLeaf(m.state.credential!));
});

const report = (m: Actor, o: Partial<{ showSite: boolean; showRole: boolean; severity: number }> = {}) =>
  sim.fileReport(m, { category: 4, severity: o.severity ?? 4, contentHash: hash(), showSite: o.showSite ?? true, showRole: o.showRole ?? false });

describe("deployment and enrolment", () => {
  it("publishes only the operator's key hash, the org name and round 1", () => {
    expect(hex(sim.ledger.operator)).toBe(hex(operatorKey(op.state.operatorSecret!)));
    expect(sim.ledger.orgName).toBe("Example Logistics (synthetic)");
    expect(sim.ledger.round).toBe(1n);
    expect(sim.ledger.rosterSize).toBe(3n);
  });

  it("only the operator can enrol, advance rounds or set a status", async () => {
    await expect(sim.enroll(ana, hash())).rejects.toThrow(/operator only/);
    await expect(sim.advanceRound(ana)).rejects.toThrow(/operator only/);
    const id = await report(ana);
    await expect(sim.setStatus(ben, id, Status.RESOLVED)).rejects.toThrow(/operator only/);
    await sim.setStatus(op, id, Status.INVESTIGATING);
    expect(sim.ledger.reports.lookup(id).status).toBe(Status.INVESTIGATING);
  });

  it("roster leaves hide the member: same site and role, different leaves", () => {
    expect(hex(memberLeaf(ana.state.credential!))).not.toBe(hex(memberLeaf(ben.state.credential!)));
  });
});

describe("filing reports with selective disclosure", () => {
  it("discloses exactly the attributes the reporter opts into", async () => {
    const a = await report(ana, { showSite: true, showRole: false });
    const b = await report(ben, { showSite: false, showRole: true });
    const c = await report(cai, { showSite: false, showRole: false });
    const ra = sim.ledger.reports.lookup(a), rb = sim.ledger.reports.lookup(b), rc = sim.ledger.reports.lookup(c);
    expect([ra.siteShown, ra.site, ra.roleShown, ra.role]).toEqual([true, BigInt(SITE_DEPOT), false, 0n]);
    expect([rb.siteShown, rb.site, rb.roleShown, rb.role]).toEqual([false, 0n, true, BigInt(ROLE_DRIVER)]);
    expect([rc.siteShown, rc.site, rc.roleShown, rc.role]).toEqual([false, 0n, false, 0n]);
    expect(sim.ledger.reportCount).toBe(3n);
  });

  it("a member cannot lie about a disclosed attribute (the leaf would not be on the roster)", async () => {
    const liar: Actor = { name: "ana-lying", state: { credential: { ...ana.state.credential!, site: 9n } } };
    await expect(report(liar)).rejects.toThrow(/not on the roster/);
  });

  it("a dishonest client that forges the Merkle path is rejected inside the circuit", async () => {
    // Ana's client claims site 9 but feeds the circuit Ana's genuine roster path.
    const realLeaf = memberLeaf(ana.state.credential!);
    const forger: Actor = {
      name: "forger",
      state: { credential: { ...ana.state.credential!, site: 9n } },
      witnesses: { ...witnesses, rosterPath: ({ privateState, ledger }) => [privateState, ledger.roster.findPathForLeaf(realLeaf)!] },
    };
    await expect(report(forger)).rejects.toThrow(/path does not match credential/);
    // ...and a path that matches the forged leaf but was never enrolled fails the root check.
    const fake: Actor = {
      name: "fake",
      state: { credential: { ...ana.state.credential!, site: 9n } },
      witnesses: {
        ...witnesses,
        rosterPath: ({ privateState, ledger }, leaf) => {
          const p = ledger.roster.findPathForLeaf(realLeaf)!;
          return [privateState, { ...p, leaf }];
        },
      },
    };
    await expect(report(fake)).rejects.toThrow(/not on the roster/);
    expect(sim.ledger.reportCount).toBe(0n);
  });

  it("outsiders cannot file", async () => {
    await expect(report(newMember("outsider", SITE_DEPOT, ROLE_DRIVER))).rejects.toThrow(/not on the roster/);
  });

  it("one report per member per round; a new round re-opens it", async () => {
    await report(ana);
    await expect(report(ana)).rejects.toThrow(/already reported this round/);
    await report(ben); // other members are unaffected
    await sim.advanceRound(op);
    const id = await report(ana);
    expect(sim.ledger.reports.lookup(id).round).toBe(2n);
  });

  it("rejects severities outside 1..5", async () => {
    await expect(report(ana, { severity: 0 })).rejects.toThrow(/severity/);
    await expect(report(ana, { severity: 6 })).rejects.toThrow(/severity/);
  });

  it("nothing on the ledger links two reports by the same member", async () => {
    const first = await report(ana);
    await sim.advanceRound(op);
    const second = await report(ana);
    const r1 = sim.ledger.reports.lookup(first), r2 = sim.ledger.reports.lookup(second);
    expect(hex(r1.authorTag)).not.toBe(hex(r2.authorTag));
    const nuls = [...sim.ledger.nullifiers].map(hex);
    expect(new Set(nuls).size).toBe(2);
    const leaf = hex(memberLeaf(ana.state.credential!));
    const secret = hex(ana.state.credential!.secret);
    for (const v of [...nuls, hex(r1.authorTag), hex(r2.authorTag)]) {
      expect(v).not.toBe(leaf);
      expect(v).not.toBe(secret);
    }
  });
});

describe("anonymous corroboration", () => {
  it("counts each member once and never the author", async () => {
    const id = await report(ana);
    await sim.corroborate(ben, id);
    await sim.corroborate(cai, id);
    expect(sim.ledger.reports.lookup(id).corroborations).toBe(2n);
    await expect(sim.corroborate(ben, id)).rejects.toThrow(/already corroborated/);
    await expect(sim.corroborate(ana, id)).rejects.toThrow(/authors cannot corroborate/);
    await expect(sim.corroborate(newMember("outsider", 1, 1), id)).rejects.toThrow(/not on the roster/);
    await expect(sim.corroborate(ben, 99n)).rejects.toThrow(/no such report/);
  });

  it("a corroboration does not use up the member's own report for the round", async () => {
    const id = await report(ana);
    await sim.corroborate(ben, id);
    await report(ben);
    expect(sim.ledger.reportCount).toBe(2n);
  });
});

describe("authorship on the reporter's terms", () => {
  it("only the author can claim, once, to a key of their choice", async () => {
    const id = await report(ana);
    const lawyer = hash();
    await expect(sim.claimAuthorship(ben, id, lawyer)).rejects.toThrow(/not the author/);
    expect(sim.ledger.reports.lookup(id).claimed).toBe(false);
    await sim.claimAuthorship(ana, id, lawyer);
    const r = sim.ledger.reports.lookup(id);
    expect(r.claimed).toBe(true);
    expect(hex(r.claimedBy)).toBe(hex(lawyer));
    await expect(sim.claimAuthorship(ana, id, hash())).rejects.toThrow(/already claimed/);
  });
});

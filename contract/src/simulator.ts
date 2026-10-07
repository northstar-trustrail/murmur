// An in-memory Murmur deployment that runs the compiled contract circuits locally with the
// Compact runtime (no network, no proof server). Used by the tests and by the browser demo.
// SPDX-License-Identifier: Apache-2.0
import {
  type CircuitContext,
  type CircuitResults,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from "@midnight-ntwrk/compact-runtime";
import { Contract, type Credential, type Ledger, type Status, ledger, pureCircuits } from "./managed/murmur/contract/index.js";
import { type MurmurPrivateState, witnesses } from "./witnesses.js";

export type Actor = {
  name: string;
  state: MurmurPrivateState;
  /** Optional replacement witnesses, used by tests to model a dishonest client. */
  witnesses?: typeof witnesses;
};

/** What a single circuit call published: the ledger fields that changed. */
export type CallRecord = { circuit: string; actor: string; ok: boolean; error?: string; result?: unknown };

export const randomBytes = (n: number): Uint8Array => {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
};

export const memberLeaf = (c: Credential): Uint8Array => pureCircuits.memberLeaf(c);
export const operatorKey = (sk: Uint8Array): Uint8Array => pureCircuits.operatorKey(sk);

export class MurmurSimulator {
  readonly contract = new Contract<MurmurPrivateState>(witnesses);
  /** The contract's public state: the only thing a real deployment would put on chain. */
  private state!: Parameters<typeof createCircuitContext>[0]["contractState"];
  readonly address = sampleContractAddress();
  readonly log: CallRecord[] = [];

  private constructor() {}

  /** Deploys a fresh contract with `operator` as the organisation's operator. */
  static async deploy(operator: Actor, orgName: string): Promise<MurmurSimulator> {
    const sim = new MurmurSimulator();
    const init = await sim.contract.initialState(createConstructorContext(operator.state, "0".repeat(64)), orgName);
    sim.state = init.currentContractState;
    return sim;
  }

  get ledger(): Ledger {
    const st = this.state as { data?: unknown };
    return ledger((st.data ?? st) as Parameters<typeof ledger>[0]);
  }

  /** Runs one circuit as `actor`. The actor's private state is swapped in, exactly as each
   *  user's wallet would supply its own private state to its own proof. */
  private async call<T>(actor: Actor, circuit: string, run: (ctx: CircuitContext<MurmurPrivateState>, k: Contract<MurmurPrivateState>) => Promise<CircuitResults<MurmurPrivateState, T>>): Promise<T> {
    const ctx = createCircuitContext<MurmurPrivateState>({
      circuitId: circuit,
      contractAddress: this.address,
      coinPublicKeyOrZswapState: "0".repeat(64),
      contractState: this.state,
      privateState: actor.state,
    });
    try {
      const out = await run(ctx, actor.witnesses ? new Contract<MurmurPrivateState>(actor.witnesses) : this.contract);
      this.state = out.context.callContext.currentQueryContext.state;
      this.log.push({ circuit, actor: actor.name, ok: true, result: out.result });
      return out.result;
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      this.log.push({ circuit, actor: actor.name, ok: false, error });
      throw e;
    }
  }

  enroll(operator: Actor, leaf: Uint8Array) {
    return this.call(operator, "enroll", (c, k) => k.impureCircuits.enroll(c, leaf));
  }
  advanceRound(operator: Actor) {
    return this.call(operator, "advanceRound", (c, k) => k.impureCircuits.advanceRound(c));
  }
  setStatus(operator: Actor, id: bigint, status: Status) {
    return this.call(operator, "setStatus", (c, k) => k.impureCircuits.setStatus(c, id, status));
  }
  fileReport(member: Actor, r: { category: number; severity: number; contentHash: Uint8Array; showSite: boolean; showRole: boolean }) {
    return this.call(member, "fileReport", (c, k) =>
      k.impureCircuits.fileReport(c, BigInt(r.category), BigInt(r.severity), r.contentHash, r.showSite, r.showRole),
    );
  }
  corroborate(member: Actor, id: bigint) {
    return this.call(member, "corroborate", (c, k) => k.impureCircuits.corroborate(c, id));
  }
  claimAuthorship(member: Actor, id: bigint, claimant: Uint8Array) {
    return this.call(member, "claimAuthorship", (c, k) => k.impureCircuits.claimAuthorship(c, id, claimant));
  }
}

/** Creates a member with a fresh secret and the given attributes. */
export const newMember = (name: string, site: number, role: number): Actor => ({
  name,
  state: { credential: { secret: randomBytes(32), site: BigInt(site), role: BigInt(role) } },
});

export const newOperator = (name: string): Actor => ({ name, state: { operatorSecret: randomBytes(32) } });

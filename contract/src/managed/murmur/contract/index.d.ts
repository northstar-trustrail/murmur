import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum Status { RECEIVED = 0,
                     INVESTIGATING = 1,
                     RESOLVED = 2,
                     DISMISSED = 3
}

export type Credential = { secret: Uint8Array; site: bigint; role: bigint };

export type Report = { round: bigint;
                       category: bigint;
                       severity: bigint;
                       siteShown: boolean;
                       site: bigint;
                       roleShown: boolean;
                       role: bigint;
                       contentHash: Uint8Array;
                       authorTag: Uint8Array;
                       corroborations: bigint;
                       status: Status;
                       claimed: boolean;
                       claimedBy: Uint8Array
                     };

export type Witnesses<PS> = {
  credential(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Credential];
  rosterPath(context: __compactRuntime.WitnessContext<Ledger, PS>,
             leaf_0: Uint8Array): [PS, { leaf: Uint8Array,
                                         path: { sibling: { field: bigint },
                                                 goes_left: boolean
                                               }[]
                                       }];
  operatorSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  enroll(context: __compactRuntime.CircuitContext<PS>, leaf_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, []>>;
  advanceRound(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
  setStatus(context: __compactRuntime.CircuitContext<PS>,
            id_0: bigint,
            status_0: Status): Promise<__compactRuntime.CircuitResults<PS, []>>;
  fileReport(context: __compactRuntime.CircuitContext<PS>,
             category_0: bigint,
             severity_0: bigint,
             contentHash_0: Uint8Array,
             showSite_0: boolean,
             showRole_0: boolean): Promise<__compactRuntime.CircuitResults<PS, bigint>>;
  corroborate(context: __compactRuntime.CircuitContext<PS>, id_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  claimAuthorship(context: __compactRuntime.CircuitContext<PS>,
                  id_0: bigint,
                  claimant_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type ProvableCircuits<PS> = {
  enroll(context: __compactRuntime.CircuitContext<PS>, leaf_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, []>>;
  advanceRound(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
  setStatus(context: __compactRuntime.CircuitContext<PS>,
            id_0: bigint,
            status_0: Status): Promise<__compactRuntime.CircuitResults<PS, []>>;
  fileReport(context: __compactRuntime.CircuitContext<PS>,
             category_0: bigint,
             severity_0: bigint,
             contentHash_0: Uint8Array,
             showSite_0: boolean,
             showRole_0: boolean): Promise<__compactRuntime.CircuitResults<PS, bigint>>;
  corroborate(context: __compactRuntime.CircuitContext<PS>, id_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  claimAuthorship(context: __compactRuntime.CircuitContext<PS>,
                  id_0: bigint,
                  claimant_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, []>>;
}

export type PureCircuits = {
  memberLeaf(c_0: Credential): Uint8Array;
  operatorKey(sk_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  enroll(context: __compactRuntime.CircuitContext<PS>, leaf_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, []>>;
  advanceRound(context: __compactRuntime.CircuitContext<PS>): Promise<__compactRuntime.CircuitResults<PS, []>>;
  setStatus(context: __compactRuntime.CircuitContext<PS>,
            id_0: bigint,
            status_0: Status): Promise<__compactRuntime.CircuitResults<PS, []>>;
  fileReport(context: __compactRuntime.CircuitContext<PS>,
             category_0: bigint,
             severity_0: bigint,
             contentHash_0: Uint8Array,
             showSite_0: boolean,
             showRole_0: boolean): Promise<__compactRuntime.CircuitResults<PS, bigint>>;
  corroborate(context: __compactRuntime.CircuitContext<PS>, id_0: bigint): Promise<__compactRuntime.CircuitResults<PS, []>>;
  claimAuthorship(context: __compactRuntime.CircuitContext<PS>,
                  id_0: bigint,
                  claimant_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, []>>;
  memberLeaf(context: __compactRuntime.CircuitContext<PS>, c_0: Credential): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
  operatorKey(context: __compactRuntime.CircuitContext<PS>, sk_0: Uint8Array): Promise<__compactRuntime.CircuitResults<PS, Uint8Array>>;
}

export type Ledger = {
  readonly operator: Uint8Array;
  readonly orgName: string;
  readonly round: bigint;
  roster: {
    isFull(): boolean;
    checkRoot(rt_0: { field: bigint }): boolean;
    root(): __compactRuntime.MerkleTreeDigest;
    firstFree(): bigint;
    pathForLeaf(index_0: bigint, leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array>;
    findPathForLeaf(leaf_0: Uint8Array): __compactRuntime.MerkleTreePath<Uint8Array> | undefined;
    history(): Iterator<__compactRuntime.MerkleTreeDigest>
  };
  readonly rosterSize: bigint;
  nullifiers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  reports: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: bigint): boolean;
    lookup(key_0: bigint): Report;
    [Symbol.iterator](): Iterator<[bigint, Report]>
  };
  readonly reportCount: bigint;
}

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>, name_0: string): Promise<__compactRuntime.ConstructorResult<PS>>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
export declare const expectedVk: Record<string, string>;
export declare const circuitSignatures: __compactRuntime.CircuitSignatures;
export declare const declaredInterfaces: __compactRuntime.DeclaredInterfaces;

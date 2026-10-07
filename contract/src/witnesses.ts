// Private state and witness implementations for Murmur.
// SPDX-License-Identifier: Apache-2.0
//
// Everything in this file runs on the member's (or operator's) own device. The values returned
// here feed the zero-knowledge proof; only what the contract explicitly `disclose()`s reaches
// the public ledger.
import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";
import type { Credential, Ledger } from "./managed/murmur/contract/index.js";

export type MurmurPrivateState = {
  /** A member's credential: secret + attributes. Absent for a pure operator. */
  readonly credential?: Credential;
  /** The operator's secret key. Absent for members. */
  readonly operatorSecret?: Uint8Array;
};

const ZERO32 = new Uint8Array(32);

export const witnesses = {
  credential: ({ privateState }: WitnessContext<Ledger, MurmurPrivateState>): [MurmurPrivateState, Credential] => {
    if (!privateState.credential) throw new Error("no member credential in private state");
    return [privateState, privateState.credential];
  },
  rosterPath: (
    { privateState, ledger }: WitnessContext<Ledger, MurmurPrivateState>,
    leaf: Uint8Array,
  ): [MurmurPrivateState, ReturnType<Ledger["roster"]["pathForLeaf"]>] => {
    const path = ledger.roster.findPathForLeaf(leaf);
    if (!path) throw new Error("credential is not on the roster");
    return [privateState, path];
  },
  operatorSecret: ({ privateState }: WitnessContext<Ledger, MurmurPrivateState>): [MurmurPrivateState, Uint8Array] => [
    privateState,
    privateState.operatorSecret ?? ZERO32,
  ],
};

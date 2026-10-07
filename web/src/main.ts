// Murmur demo UI. Runs the compiled Compact contract in the browser via the Compact runtime.
// SPDX-License-Identifier: Apache-2.0
import "./style.css";
import {
  type Actor,
  MurmurSimulator,
  Status,
  memberLeaf,
  newMember,
  newOperator,
  randomBytes,
  type Report,
} from "@murmur/contract";

// ------------------------------------------------------------------ synthetic organisation
const ORG = "Example Freight Co. (synthetic)";
const SITES: Record<number, string> = { 1: "Head office", 2: "North depot", 3: "South depot" };
const ROLES: Record<number, string> = { 3: "Driver", 4: "Warehouse", 7: "Manager" };
const CATEGORIES = ["Safety hazard", "Harassment", "Wage & hours", "Fraud / ethics", "Discrimination", "Other"];
const STATUS = ["Received", "Investigating", "Resolved", "Dismissed"];

type Kind = "operator" | "member" | "outsider";
type Persona = {
  key: string;
  label: string;
  sub: string;
  kind: Kind;
  hue: number;
  actor: Actor;
  enrolled: boolean;
  /** Purely local bookkeeping on this persona's device: its own report ids and drafts. */
  mine: { id: bigint; text: string }[];
};

type Tx = { n: number; circuit: string; seenAs: string; truly: string; ok: boolean; detail: string; disclosed?: string[]; hidden?: string[] };

// ------------------------------------------------------------------ helpers
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const short = (h: string, a = 8, z = 6) => (h.length > a + z + 1 ? `${h.slice(0, a)}…${h.slice(-z)}` : h);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector(sel) as T;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
}
const errText = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e);
  const hit = m.match(/failed assert: (.*)$/m) ?? m.match(/(not on the roster|operator only|already [a-z ]+|authors cannot[a-z ]+|not the author|no such report|severity must be 1\.\.5)/);
  return hit ? hit[1] : m;
};

// ------------------------------------------------------------------ app state
let sim: MurmurSimulator;
let people: Persona[] = [];
let current = "op";
let txs: Tx[] = [];
let inbox = new Map<string, string>(); // contentHash -> plaintext, delivered off-chain (encrypted) to the operator
let busy = false;
let lastChanged = new Set<string>();
let prevSnapshot = new Map<string, string>();

const persona = (k: string) => people.find((p) => p.key === k)!;

async function setup() {
  const op = newOperator("Compliance office");
  people = [
    { key: "op", label: "Compliance office", sub: "Operator · runs the programme", kind: "operator", hue: 265, actor: op, enrolled: false, mine: [] },
    { key: "ana", label: "Ana", sub: `${SITES[2]} · ${ROLES[3]}`, kind: "member", hue: 160, actor: newMember("Ana", 2, 3), enrolled: false, mine: [] },
    { key: "ben", label: "Ben", sub: `${SITES[2]} · ${ROLES[4]}`, kind: "member", hue: 200, actor: newMember("Ben", 2, 4), enrolled: false, mine: [] },
    { key: "cai", label: "Cai", sub: `${SITES[1]} · ${ROLES[7]}`, kind: "member", hue: 30, actor: newMember("Cai", 1, 7), enrolled: false, mine: [] },
    { key: "eve", label: "Eve", sub: "Not on staff · claims North depot", kind: "outsider", hue: 0, actor: newMember("Eve", 2, 3), enrolled: false, mine: [] },
  ];
  sim = await MurmurSimulator.deploy(op, ORG);
  txs = [];
  inbox = new Map();
  prevSnapshot = new Map();
  record({ circuit: "deploy", seenAs: "deployer", truly: "Compliance office", ok: true, detail: `Contract deployed for “${ORG}”. Only a hash of the operator key is public.`, disclosed: ["org name", "hash(operator secret)"], hidden: ["operator secret"] });
  current = "op";
  render();
}

function record(t: Omit<Tx, "n">) {
  txs.unshift({ n: txs.length + 1, ...t });
}

/** Runs one contract call as the current persona and records what the chain saw. */
async function act(label: string, fn: () => Promise<unknown>, meta: { disclosed?: string[]; hidden?: string[]; ok?: (r: unknown) => string; seenAs?: string }) {
  if (busy) return;
  busy = true;
  const p = persona(current);
  const seenAs = meta.seenAs ?? (p.kind === "operator" ? "operator key ✓" : "an enrolled member (ZK proof)");
  try {
    const r = await fn();
    record({ circuit: label, seenAs, truly: p.label, ok: true, detail: meta.ok ? meta.ok(r) : "accepted", disclosed: meta.disclosed, hidden: meta.hidden });
    toast(`✓ ${label} accepted`, "ok");
  } catch (e) {
    record({ circuit: label, seenAs: p.kind === "operator" ? "operator key" : "a prover", truly: p.label, ok: false, detail: `rejected by the contract: ${errText(e)}` });
    toast(`✗ ${label} rejected: ${errText(e)}`, "bad");
  } finally {
    busy = false;
    render();
  }
}

// ------------------------------------------------------------------ actions
async function enroll(k: string) {
  const m = persona(k);
  current = "op";
  await act("enroll", () => sim.enroll(persona("op").actor, memberLeaf(m.actor.state.credential!)), {
    ok: () => `commitment ${short(hex(memberLeaf(m.actor.state.credential!)))} added to the roster tree`,
    disclosed: ["a hiding commitment"],
    hidden: ["member secret", "site", "role", "who it belongs to"],
  });
  if (sim.log.at(-1)?.ok) m.enrolled = true;
  render();
}

async function fileReport(o: { category: number; severity: number; text: string; showSite: boolean; showRole: boolean }) {
  const p = persona(current);
  const h = await sha256(o.text);
  const disclosed = ["category", "severity", "hash of the text", "round nullifier", "author tag", "a valid roster root"];
  if (o.showSite) disclosed.push("site");
  if (o.showRole) disclosed.push("role");
  const hidden = ["who filed it", "which roster entry", "member secret"];
  if (!o.showSite) hidden.push("site");
  if (!o.showRole) hidden.push("role");
  await act(
    "fileReport",
    async () => {
      const id = await sim.fileReport(p.actor, { category: o.category, severity: o.severity, contentHash: h, showSite: o.showSite, showRole: o.showRole });
      p.mine.push({ id, text: o.text });
      inbox.set(hex(h), o.text);
      return id;
    },
    { ok: (id) => `report #${id} filed`, disclosed, hidden },
  );
}

async function corroborate(id: bigint) {
  await act("corroborate", () => sim.corroborate(persona(current).actor, id), {
    ok: () => `report #${id} corroborated`,
    disclosed: ["report id", "corroboration nullifier", "a valid roster root"],
    hidden: ["who corroborated", "their site and role"],
  });
}

async function claim(id: bigint, claimant: Uint8Array) {
  await act("claimAuthorship", () => sim.claimAuthorship(persona(current).actor, id, claimant), {
    ok: () => `report #${id} now provably linked to key ${short(hex(claimant))}`,
    disclosed: ["the claimant key the author chose"],
    hidden: ["member secret", "the author's other reports"],
  });
}

async function setStatus(id: bigint, s: Status) {
  current = "op";
  await act("setStatus", () => sim.setStatus(persona("op").actor, id, s), { ok: () => `report #${id} → ${STATUS[s]}`, disclosed: ["status"], hidden: [] });
}

async function advanceRound() {
  current = "op";
  await act("advanceRound", () => sim.advanceRound(persona("op").actor), { ok: () => `round ${sim.ledger.round} opened`, disclosed: ["round counter"], hidden: [] });
}

// ------------------------------------------------------------------ rendering
function reports(): [bigint, Report][] {
  return [...sim.ledger.reports].sort((a, b) => Number(a[0] - b[0]));
}

function snapshot(): Map<string, string> {
  const L = sim.ledger;
  const m = new Map<string, string>();
  m.set("round", String(L.round));
  m.set("rosterSize", String(L.rosterSize));
  m.set("root", String(L.roster.root().field));
  m.set("nullifiers", String(L.nullifiers.size()));
  m.set("reportCount", String(L.reportCount));
  for (const [id, r] of reports()) m.set(`r${id}`, `${r.corroborations}|${r.status}|${r.claimed}`);
  return m;
}

function render() {
  const snap = snapshot();
  lastChanged = new Set([...snap].filter(([k, v]) => prevSnapshot.size > 0 && prevSnapshot.get(k) !== v).map(([k]) => k));
  prevSnapshot = snap;
  renderPersonas();
  renderPrivate();
  renderActions();
  renderLedger();
  renderTx();
}

function renderPersonas() {
  $("#personas").innerHTML = people
    .map(
      (p) => `<button class="persona ${p.key === current ? "on" : ""} ${p.kind}" data-k="${p.key}" style="--h:${p.hue}">
        <span class="av">${p.kind === "operator" ? "⚖" : p.label[0]}</span>
        <span class="pl"><b>${esc(p.label)}</b><small>${esc(p.sub)}</small></span>
        <span class="badge">${p.kind === "operator" ? "operator" : p.kind === "outsider" ? "not enrolled" : p.enrolled ? "enrolled" : "not yet enrolled"}</span>
      </button>`,
    )
    .join("");
  document.querySelectorAll<HTMLButtonElement>(".persona").forEach((b) => (b.onclick = () => ((current = b.dataset.k!), render())));
}

function renderPrivate() {
  const p = persona(current);
  const s = p.actor.state;
  let h = "";
  if (s.operatorSecret) h += row("Operator secret", `<code>${short(hex(s.operatorSecret), 10, 4)}</code>`);
  if (s.credential) {
    const c = s.credential;
    h += row("Member secret", `<code>${short(hex(c.secret), 10, 4)}</code>`);
    h += row("Site", SITES[Number(c.site)] ?? String(c.site));
    h += row("Role", ROLES[Number(c.role)] ?? String(c.role));
    h += row("Roster commitment", `<code>${short(hex(memberLeaf(c)))}</code>`);
  }
  if (p.mine.length) h += row("My reports", p.mine.map((m) => `#${m.id}`).join(", "));
  h += `<p class="note">${p.kind === "operator" ? "The chain only stores <b>hash(operator secret)</b>. Operator actions prove knowledge of the secret." : p.kind === "outsider" ? "Eve made up a credential. Her commitment was never enrolled, so no valid Merkle path exists." : "Never leaves this device. The contract sees it only as a witness inside the zero-knowledge proof."}</p>`;
  $("#private").innerHTML = h;
}

const row = (k: string, v: string, cls = "") => `<div class="kv ${cls}"><span>${k}</span><span>${v}</span></div>`;

function renderActions() {
  const p = persona(current);
  const el = $("#actions");
  if (p.kind === "operator") {
    const staff = people.filter((x) => x.kind === "member");
    el.innerHTML = `
      <div class="panel">
        <h3>Enrol staff</h3>
        <p class="note">Each employee hands over a <b>commitment</b> = hash(secret, site, role). The operator learns nothing it can later match to a report.</p>
        ${staff
          .map(
            (m) => `<div class="enrol"><span><b>${m.label}</b> <small>${esc(m.sub)}</small><br><code>${short(hex(memberLeaf(m.actor.state.credential!)))}</code></span>
            ${m.enrolled ? `<span class="ok">✓ enrolled</span>` : `<button data-enrol="${m.key}">Enrol</button>`}</div>`,
          )
          .join("")}
      </div>
      <div class="panel">
        <h3>Rounds</h3>
        <p class="note">Each member can file one report per round. Round ${sim.ledger.round} is open.</p>
        <button id="btn-round">Open round ${sim.ledger.round + 1n}</button>
      </div>
      <div class="panel">
        <h3>Case inbox</h3>
        <p class="note">Report text arrives encrypted off-chain. Murmur checks it against the hash on the ledger, so it can't be altered.</p>
        ${reports().length === 0 ? `<p class="empty">No reports yet.</p>` : reports().map(([id, r]) => caseCard(id, r)).join("")}
      </div>`;
    el.querySelectorAll<HTMLButtonElement>("[data-enrol]").forEach((b) => (b.onclick = () => enroll(b.dataset.enrol!)));
    $("#btn-round").onclick = advanceRound;
    el.querySelectorAll<HTMLButtonElement>("[data-status]").forEach((b) => (b.onclick = () => setStatus(BigInt(b.dataset.id!), Number(b.dataset.status) as Status)));
    return;
  }
  const c = p.actor.state.credential!;
  el.innerHTML = `
    <div class="panel">
      <h3>File a report <small>round ${sim.ledger.round}</small></h3>
      <label>Category <select id="f-cat">${CATEGORIES.map((c, i) => `<option value="${i}">${c}</option>`).join("")}</select></label>
      <label>Severity <span class="sev">${[1, 2, 3, 4, 5].map((n) => `<label class="sevopt"><input type="radio" name="sev" value="${n}" ${n === 3 ? "checked" : ""}><span>${n}</span></label>`).join("")}</span></label>
      <label>What happened? <textarea id="f-text" rows="3" placeholder="Only a hash goes on chain."></textarea></label>
      <div class="disclose">
        <span>Disclose from my credential:</span>
        <label class="tog"><input type="checkbox" id="f-site"> my site <em>(${SITES[Number(c.site)]})</em></label>
        <label class="tog"><input type="checkbox" id="f-role"> my role <em>(${ROLES[Number(c.role)]})</em></label>
      </div>
      <button id="btn-file" class="primary">Prove membership &amp; file anonymously</button>
    </div>
    <div class="panel">
      <h3>Corroborate a report</h3>
      <p class="note">Vouch that you've seen it too. Once per report, never your own, and nobody learns who you are.</p>
      ${reports().length === 0 ? `<p class="empty">No reports yet.</p>` : reports().map(([id, r]) => `<div class="mini"><span>#${id} · ${CATEGORIES[Number(r.category)]} · sev ${r.severity} · 👥 ${r.corroborations}</span><button data-corr="${id}">Corroborate</button></div>`).join("")}
    </div>
    <div class="panel">
      <h3>My reports <small>known only to this device</small></h3>
      ${p.mine.length === 0 ? `<p class="empty">You haven't filed anything.</p>` : p.mine.map((m) => mineCard(m.id)).join("")}
    </div>`;
  $("#btn-file").onclick = submitForm;
  el.querySelectorAll<HTMLButtonElement>("[data-corr]").forEach((b) => (b.onclick = () => corroborate(BigInt(b.dataset.corr!))));
  el.querySelectorAll<HTMLButtonElement>("[data-claim]").forEach((b) => (b.onclick = () => claim(BigInt(b.dataset.claim!), randomBytes(32))));
}

function submitForm() {
  return fileReport({
      category: Number($<HTMLSelectElement>("#f-cat").value),
      severity: Number(($<HTMLInputElement>("input[name=sev]:checked") ?? { value: "3" }).value),
      text: $<HTMLTextAreaElement>("#f-text").value || "(no text)",
      showSite: $<HTMLInputElement>("#f-site").checked,
      showRole: $<HTMLInputElement>("#f-role").checked,
    });
}

function caseCard(id: bigint, r: Report) {
  const text = inbox.get(hex(r.contentHash));
  return `<div class="case">
    <div class="case-h"><b>#${id} · ${CATEGORIES[Number(r.category)]}</b><span class="sevb s${r.severity}">severity ${r.severity}</span><span class="st st${r.status}">${STATUS[r.status]}</span></div>
    <div class="case-t">${text ? `“${esc(text)}” <span class="ok">✓ matches on-chain hash</span>` : "<em>text not delivered</em>"}</div>
    <div class="case-m">From: ${r.siteShown ? SITES[Number(r.site)] : "site hidden"} · ${r.roleShown ? ROLES[Number(r.role)] : "role hidden"} · 👥 ${r.corroborations} corroboration${r.corroborations === 1n ? "" : "s"}${r.claimed ? ` · authorship claimed by ${short(hex(r.claimedBy))}` : ""}</div>
    <div class="case-a">${[1, 2, 3].map((s) => `<button data-status="${s}" data-id="${id}" ${r.status === s ? "disabled" : ""}>${STATUS[s]}</button>`).join("")}</div>
  </div>`;
}

function mineCard(id: bigint) {
  const r = sim.ledger.reports.lookup(id);
  return `<div class="mini"><span>#${id} · ${STATUS[r.status]} · 👥 ${r.corroborations}${r.claimed ? ` · claimed → ${short(hex(r.claimedBy))}` : ""}</span>${r.claimed ? "" : `<button data-claim="${id}" title="Link this report to a key you choose, e.g. a lawyer's">Prove authorship to my counsel</button>`}</div>`;
}

function renderLedger() {
  const L = sim.ledger;
  const ch = (k: string) => (lastChanged.has(k) ? "flash" : "");
  const nul = [...L.nullifiers].map((n) => `<code>${short(hex(n), 6, 4)}</code>`).join(" ");
  $("#ledger").innerHTML = `
    ${row("orgName", esc(L.orgName))}
    ${row("operator", `<code>${short(hex(L.operator))}</code> <small>hash only</small>`)}
    ${row("round", String(L.round), ch("round"))}
    ${row("rosterSize", String(L.rosterSize), ch("rosterSize"))}
    ${row("roster root", `<code>${short(L.roster.root().field.toString(16).padStart(64, "0"))}</code>`, ch("root"))}
    ${row("nullifiers", `${L.nullifiers.size()} <div class="nuls">${nul || "<small>none</small>"}</div>`, ch("nullifiers"))}
    ${row("reportCount", String(L.reportCount), ch("reportCount"))}
    <div class="reports">${
      reports().length === 0
        ? `<p class="empty">reports: {}</p>`
        : reports()
            .map(
              ([id, r]) => `<div class="rep ${ch(`r${id}`)}">
          <div class="rep-h"><b>reports[${id}]</b><span class="st st${r.status}">${STATUS[r.status]}</span></div>
          <div class="rep-g">
            <span>category</span><span>${CATEGORIES[Number(r.category)]}</span>
            <span>severity</span><span>${r.severity}</span>
            <span>site</span><span>${r.siteShown ? `<b>${SITES[Number(r.site)]}</b>` : `<i>hidden</i>`}</span>
            <span>role</span><span>${r.roleShown ? `<b>${ROLES[Number(r.role)]}</b>` : `<i>hidden</i>`}</span>
            <span>contentHash</span><span><code>${short(hex(r.contentHash), 6, 4)}</code></span>
            <span>authorTag</span><span><code>${short(hex(r.authorTag), 6, 4)}</code></span>
            <span>corroborations</span><span>${r.corroborations}</span>
            <span>claimedBy</span><span>${r.claimed ? `<code>${short(hex(r.claimedBy), 6, 4)}</code>` : "<i>unclaimed</i>"}</span>
          </div></div>`,
            )
            .join("")
    }</div>
    <p class="note">Nowhere on this ledger is a name, a roster position, or anything that links two reports to the same person.</p>`;
}

function renderTx() {
  $("#txlog").innerHTML = txs
    .slice(0, 14)
    .map(
      (t) => `<li class="${t.ok ? "ok" : "bad"}">
        <div class="tx-h"><b>${t.circuit}</b><span>${t.ok ? "✓" : "✗"}</span></div>
        <div class="tx-who">chain sees: <b>${t.seenAs}</b> <span class="truly">(actually ${esc(t.truly)}; only this demo knows)</span></div>
        <div class="tx-d">${esc(t.detail)}</div>
        ${t.disclosed?.length ? `<div class="tx-x"><span class="pub">public:</span> ${t.disclosed.join(", ")}</div>` : ""}
        ${t.hidden?.length ? `<div class="tx-x"><span class="priv">kept private:</span> ${t.hidden.join(", ")}</div>` : ""}
      </li>`,
    )
    .join("");
}

let toastTimer: number | undefined;
function toast(msg: string, kind: "ok" | "bad") {
  const t = $("#toast");
  t.textContent = msg;
  t.className = `toast ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t.classList.add("hidden"), 2600);
}

// ------------------------------------------------------------------ guided story
type Step = { cap: string; run: () => Promise<void> };
const pick = (k: string) => {
  current = k;
  render();
};
async function fill(o: { cat: number; sev: number; text: string; site: boolean; role: boolean }) {
  $<HTMLSelectElement>("#f-cat").value = String(o.cat);
  $<HTMLInputElement>(`input[name=sev][value="${o.sev}"]`).checked = true;
  $<HTMLInputElement>("#f-site").checked = o.site;
  $<HTMLInputElement>("#f-role").checked = o.role;
  $<HTMLTextAreaElement>("#f-text").value = o.text;
}
const REPORT_TEXT = "Bay 4 forklift brakes are failing. Supervisor said keep using it until month end.";
export const STORY: Step[] = [
  { cap: "A company deploys Murmur. The ledger holds only its name and a hash of the compliance office's key.", run: async () => { await setup(); } },
  { cap: "Staff are enrolled as hiding commitments in a Merkle tree. The roster shows how many people, not who.", run: async () => { pick("op"); for (const k of ["ana", "ben", "cai"]) await enroll(k); } },
  { cap: "Ana, a North depot driver, sees something dangerous. Her credential stays on her device.", run: async () => { pick("ana"); await fill({ cat: 0, sev: 5, text: REPORT_TEXT, site: true, role: false }); } },
  { cap: "She proves she is on the roster without revealing which entry, and chooses to disclose only her site.", run: async () => { await submitForm(); } },
  { cap: "A per-round nullifier stops one person flooding the system. Her second report is rejected.", run: async () => { await fill({ cat: 0, sev: 5, text: "Again!", site: false, role: false }); await submitForm(); } },
  { cap: "Eve isn't on staff. She can invent a credential, but she can't produce a valid Merkle path.", run: async () => { pick("eve"); await fill({ cat: 1, sev: 4, text: "Fake complaint", site: true, role: true }); await submitForm(); } },
  { cap: "Ben and Cai corroborate anonymously: once each, counted on chain, identities hidden.", run: async () => { pick("ben"); await corroborate(0n); pick("cai"); await corroborate(0n); } },
  { cap: "Ana can't pad her own report. The circuit checks she isn't the author without revealing who she is.", run: async () => { pick("ana"); await corroborate(0n); } },
  { cap: "The compliance office reads the text, delivered off-chain and checked against the hash, and opens an investigation.", run: async () => { pick("op"); await setStatus(0n, Status.INVESTIGATING); } },
  { cap: "If Ana ever needs credit or legal protection, she proves authorship to a key she chooses, on her terms.", run: async () => { pick("ana"); await claim(0n, randomBytes(32)); } },
  { cap: "Case resolved. Verified, rate-limited, corroborated, and nobody was exposed.", run: async () => { pick("op"); await setStatus(0n, Status.RESOLVED); } },
];

async function playStory(delay = 4200) {
  const cap = $("#caption");
  cap.classList.remove("hidden");
  for (let i = 0; i < STORY.length; i++) {
    $("#cap-step").textContent = `${i + 1} / ${STORY.length}`;
    $("#cap-text").textContent = STORY[i].cap;
    await STORY[i].run();
    await sleep(delay);
  }
  await sleep(1500);
  cap.classList.add("hidden");
}

// For automated screenshots: window.murmur.step(i) runs step i and shows its caption.
declare global {
  interface Window {
    murmur: { step: (i: number) => Promise<void>; steps: number; setup: () => Promise<void>; caption: (on: boolean) => void };
  }
}
window.murmur = {
  steps: STORY.length,
  setup,
  caption: (on) => $("#caption").classList.toggle("hidden", !on),
  step: async (i) => {
    $("#caption").classList.remove("hidden");
    $("#cap-step").textContent = `${i + 1} / ${STORY.length}`;
    $("#cap-text").textContent = STORY[i].cap;
    await STORY[i].run();
  },
};

$("#btn-story").onclick = () => playStory();
$("#btn-reset").onclick = () => setup();
await setup();
if (new URLSearchParams(location.search).has("story")) playStory();
document.body.dataset.ready = "1";

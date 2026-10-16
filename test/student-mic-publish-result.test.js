const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "../public/js/student-live.js"), "utf8");
function harness() {
  const track = { readyState: "live" }, sender = { __isStudentMic: true, async replaceTrack() {} };
  const peer = { signalingState: "stable", getSenders: () => [sender],
    async createOffer() { return { type: "offer", sdp: "test" }; },
    async setLocalDescription(description) { this.localDescription = description; this.signalingState = description.type === "rollback" ? "stable" : "have-local-offer"; },
  };
  const status = [], reports = [];
  const ctx = { pc: peer, studentP2pMicSender: sender, microphonePermissionGranted: true,
    microphoneOfferSent: false, microphoneNegotiated: false, isMakingRenegotiationOffer: false,
    teacherSocketId: "teacher", localAudioStream: { getAudioTracks: () => [track] },
    window: { LiveDoctor: { report: code => reports.push(code) } }, rtcConfig: {},
    console: { warn() {}, error() {} }, setViewerStatus: message => status.push(message),
    emitWithAcknowledgement: async () => ({ ok: true }), optimizeOpusSdp: s => s,
    RTCSessionDescription: class { constructor(value) { Object.assign(this, value); } },
  };
  vm.createContext(ctx);
  for (const name of ["publishStudentP2pMic", "negotiateStudentMicrophone"]) {
    vm.runInContext(source.match(new RegExp(`^async function ${name}\\([^]*?^\\}`, "m"))[0], ctx);
  }
  return { ctx, track, sender, peer, status, reports, publish: () => ctx.publishStudentP2pMic(track, ctx.localAudioStream) };
}
test("failed replaceTrack does not negotiate or report publication success", async () => {
  const h = harness(); let calls = 0;
  h.sender.replaceTrack = async () => { throw new Error("failed"); };
  h.peer.createOffer = async () => { calls++; };
  assert.equal(await h.publish(), false); assert.equal(calls, 0);
  assert.ok(h.reports.includes("microphone_replace_track_failed"));
});
test("relay rejection returns false and rolls back so a subsequent attempt can work", async () => {
  const h = harness();
  h.ctx.emitWithAcknowledgement = async () => { throw new Error("relay denied"); };
  assert.equal(await h.publish(), false);
  assert.equal(h.peer.signalingState, "stable");
  assert.equal(h.ctx.microphoneOfferSent, false);
  h.ctx.emitWithAcknowledgement = async () => ({ ok: true });
  assert.equal(await h.publish(), true);
  assert.equal(h.ctx.microphoneOfferSent, true);
});
test("a busy peer is not reported as a successfully negotiated microphone", async () => {
  const h = harness(); h.peer.signalingState = "have-remote-offer";
  assert.equal(await h.publish(), false);
});
test("peer replacement while replacing a track cannot negotiate the replacement", async () => {
  const h = harness(); h.sender.replaceTrack = async () => { h.ctx.pc = { signalingState: "stable" }; };
  assert.equal(await h.publish(), false);
});
test("revocation while creating an offer prevents its transmission", async () => {
  const h = harness(); let sent = false;
  h.peer.createOffer = async () => { h.ctx.microphonePermissionGranted = false; return { type: "offer", sdp: "test" }; };
  h.ctx.emitWithAcknowledgement = async () => { sent = true; };
  assert.equal(await h.publish(), false); assert.equal(sent, false);
});
test("stale acknowledgement cannot mark a new peer as negotiated", async () => {
  const h = harness();
  h.ctx.emitWithAcknowledgement = async () => { h.ctx.pc = { signalingState: "stable" }; };
  assert.equal(await h.publish(), false); assert.equal(h.ctx.microphoneOfferSent, false);
});

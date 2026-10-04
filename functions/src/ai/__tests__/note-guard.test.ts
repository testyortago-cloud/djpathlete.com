import { describe, it, expect } from "vitest"
import { cleanNote } from "../note-guard.js"

const none = { athleteSport: null }

describe("cleanNote — prescription sentences", () => {
  it("drops sets/reps/rest restatements and keeps the cue", () => {
    const r = cleanNote("2 sets of 4; rest 90 seconds. Lower over 4 seconds, then drive up.", none)
    expect(r.text).toBe("Lower over 4 seconds, then drive up.")
    expect(r.stripped).toEqual(["2 sets of 4; rest 90 seconds."])
  })
  it("drops per-side counts, percentages, RPE and NxN", () => {
    expect(cleanNote("6 each side. Keep hips square.", none).text).toBe("Keep hips square.")
    expect(cleanNote("Work at 80% today. Fast bar.", none).text).toBe("Fast bar.")
    expect(cleanNote("Stay at RPE 7. Smooth reps.", none).text).toBe("Smooth reps.")
    expect(cleanNote("Do 3x8. Brace.", none).text).toBe("Brace.")
  })
  it("keeps tempo wording, which is a cue", () => {
    const note = "3 second eccentric, 1 second pause, explode up."
    expect(cleanNote(note, none)).toEqual({ text: note, stripped: [] })
  })
  it("returns null, not an empty string, when every sentence goes", () => {
    expect(cleanNote("3 sets of 8. Rest 90 seconds.", none).text).toBeNull()
  })
})

describe("cleanNote — fix round 1", () => {
  it("normalises the athlete sport's case and whitespace", () => {
    const note = "Mimic your tennis split step."
    expect(cleanNote(note, { athleteSport: "Tennis " }).text).toBe(note)
    expect(cleanNote("Swing like golf. Stay tall.", { athleteSport: "Tennis " }).text).toBe("Stay tall.")
  })
  it("does not split a sentence at a decimal point", () => {
    const r = cleanNote("Rest 1.5 minutes. Brace.", none)
    expect(r.text).toBe("Brace.")
    expect(r.stripped).toEqual(["Rest 1.5 minutes."])
  })
  it("drops rest durations but keeps rest used as a cue", () => {
    expect(cleanNote("Rest 90 seconds. Brace.", none).text).toBe("Brace.")
    expect(cleanNote("Rest for 2 minutes. Brace.", none).text).toBe("Brace.")
    const a = "Rest the bar on your traps, elbows at 45 degrees."
    expect(cleanNote(a, none)).toEqual({ text: a, stripped: [] })
    const b = "Keep the rest of your body still for 3 seconds."
    expect(cleanNote(b, none)).toEqual({ text: b, stripped: [] })
  })
  it("drops RPE of N and N RPE", () => {
    expect(cleanNote("Go RPE of 7. Brace.", none).text).toBe("Brace.")
    expect(cleanNote("Go at 7 RPE. Brace.", none).text).toBe("Brace.")
  })
})

describe("cleanNote — final review", () => {
  it("I1: drops every common rest wording", () => {
    for (const s of [
      "Rest 60-90 seconds.",
      "Rest: 45.",
      "90s rest.",
      "Full 120s rest between sets.",
      "15 seconds rest between sides.",
    ]) {
      expect(cleanNote(`${s} Brace.`, none)).toEqual({ text: "Brace.", stripped: [s] })
    }
  })
  it("I1: keeps rest-as-a-cue and tempo wording", () => {
    for (const s of [
      "Rest the bar on your traps, elbows at 45 degrees.",
      "Keep the rest of your body still for 3 seconds.",
      "Lower over 3 seconds.",
    ]) {
      expect(cleanNote(s, none)).toEqual({ text: s, stripped: [] })
    }
  })
  it("M1: a multi-word athlete sport keeps its own cues", () => {
    const note = "Stay low like a hockey stop."
    expect(cleanNote(note, { athleteSport: "ice hockey" }).text).toBe(note)
    expect(cleanNote("Swing like golf. Stay tall.", { athleteSport: "ice hockey" }).text).toBe("Stay tall.")
  })
  it("M3: a newline ends a sentence, so one prescription line does not take the bullet list", () => {
    const r = cleanNote("- Brace your core\n- Rest 90 seconds\n- Drive up", none)
    expect(r.stripped).toEqual(["- Rest 90 seconds"])
    expect(r.text).toContain("Brace your core")
    expect(r.text).toContain("Drive up")
    const p = cleanNote("Brace your core.\nRest 90 seconds.\nDrive up.", none)
    expect(p.stripped).toEqual(["Rest 90 seconds."])
    expect(p.text).toContain("Brace your core.")
    expect(p.text).toContain("Drive up.")
  })
})

describe("cleanNote — sport sentences", () => {
  it("drops a sport the athlete does not play (live case: golf cue for a tennis player)", () => {
    const r = cleanNote("Rotate like a golf swing. Stay tall.", { athleteSport: "tennis" })
    expect(r.text).toBe("Stay tall.")
  })
  it("keeps the athlete's own sport", () => {
    const note = "Mimic your tennis split step."
    expect(cleanNote(note, { athleteSport: "tennis" }).text).toBe(note)
  })
  it("drops every sport mention when no sport is known", () => {
    expect(cleanNote("Land soft like a tennis player. Absorb.", none).text).toBe("Absorb.")
  })
  it("keeps a tennis BALL, which is equipment", () => {
    const note = "Squeeze a tennis ball between your knees."
    expect(cleanNote(note, { athleteSport: "pickleball" }).text).toBe(note)
  })
})

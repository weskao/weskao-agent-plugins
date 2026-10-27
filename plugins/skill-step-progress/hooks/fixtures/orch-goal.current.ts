export default {
  "status": "in_progress",
  "cmd": "goal",
  "id": "goal-test-001",
  "flow": null,
  "current_step": "2",
  "total_steps": 5,
  "step_order": [
    "1",
    "2",
    "2.T1",
    "2.T2",
    "3",
    "4",
    "5"
  ],
  "steps": {
    "1": {
      "status": "done",
      "title": "Plan"
    },
    "2": {
      "status": "in_progress",
      "title": "Execute"
    },
    "3": {
      "status": "pending",
      "title": "Verify"
    },
    "4": {
      "status": "pending",
      "title": "Post-verify"
    },
    "5": {
      "status": "pending",
      "title": "Wrap-up"
    },
    "2.T1": {
      "status": "done",
      "title": "T1 · Write the parser"
    },
    "2.T2": {
      "status": "in_progress",
      "title": "T2 · Render the pane"
    }
  },
  "started_at": "2026-10-18T20:24:16+08:00",
  "updated_at": "2026-10-18T20:24:16+08:00"
}

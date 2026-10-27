export default {
  "status": "in_progress",
  "cmd": "task",
  "id": null,
  "flow": "./flow.md",
  "current_step": "2",
  "total_steps": 3,
  "step_order": [
    "1",
    "2",
    "2.1",
    "2.2",
    "2.3",
    "3"
  ],
  "steps": {
    "1": {
      "status": "done",
      "title": "Requirements"
    },
    "2": {
      "status": "in_progress",
      "title": "Implementation"
    },
    "3": {
      "status": "pending",
      "title": "Verification"
    },
    "2.1": {
      "status": "done",
      "title": "Write a failing test"
    },
    "2.2": {
      "status": "pending",
      "title": "Make it pass"
    },
    "2.3": {
      "status": "pending",
      "title": "Refactor"
    }
  },
  "started_at": "2026-10-18T20:24:16+08:00",
  "updated_at": "2026-10-18T20:24:17+08:00"
}

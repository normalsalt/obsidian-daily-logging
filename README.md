# Daily Logging

Log what you work on to your daily note without thinking about it.

When you create a note, Daily Logging appends the time and a link to today's daily note. A task list in the sidebar shows today's recurring and scheduled tasks, and lets you log when you start, interrupt, and end each one.

```markdown
## Morning routine
---
- 06:12 [[Stretching]] started
- 06:30 [[Stretching]] ended (18 min)

## Main work
---
- 13:05 [[Fix login bug]]
- 13:40 [[Weekly report]] started
- 14:10 [[Weekly report]] interrupted (30 min)
```

## Requirements

- Obsidian 1.13.0 or later
- The **Daily notes** core plugin must be enabled. Daily Logging uses its folder, date format, and template. If today's daily note doesn't exist yet, it is created.

## Logging new files

A line is added when you create a file and open it within a few seconds on the same device. Files added by Git pull or by other tools aren't logged, because they are never opened. Daily notes themselves are never logged.

- **File extensions**: Only files with these extensions are logged (default: `md`).
- **Time slots**: Each entry is added under the heading of its time slot. If the heading doesn't exist yet, it is created. Each slot is written on one line as `time | heading | tag`.
- **Early entries**: Entries before the first time slot go to the previous day's daily note, under the last slot. In the task list, this time is also used as the start of the day.

## Task list

Open the list from the ribbon or with the **Open task list** command. Any Markdown file with one of the following properties is treated as a task. You can change the property names in the settings.

| Property    | Type        | Meaning                                                        |
| ----------- | ----------- | -------------------------------------------------------------- |
| `repeat`    | List        | Days the task appears: `Every day`, or weekdays such as `Monday` |
| `section`   | Text        | Tag of the time slot to group the task under                   |
| `scheduled` | Date & time | Show the task on this day                                      |
| `started`   | Date & time | Set by the plugin when you start the task                      |
| `ended`     | Date & time | Set by the plugin when you end or interrupt the task           |

A task is shown when one of the following applies:

- It is running.
- It is scheduled for today.
- It repeats today and hasn't been ended today.

A task scheduled for a later day is hidden until that day, even if it repeats today.

| Action    | What it does                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------- |
| Start     | Sets `started` and logs it. Works on any Markdown file, even one without properties.               |
| End       | Sets `ended` and logs it with the time spent. Clears `scheduled` if it is today or earlier.        |
| Interrupt | Sets `ended` and logs it with the time spent. Sets `scheduled` to 15 minutes later, so the task stays in the list. |

The **Start task**, **End task**, and **Interrupt task** commands work on the file that is currently open. You can assign hotkeys to them.

## Notes

- Daily Logging reads the settings of the Daily notes core plugin through an internal, undocumented API. A future Obsidian update may break it. If that happens, nothing is logged and an error appears in the developer console.
- If you sync with Git and log on more than one device, the same daily note may be edited on each device. Pull before you start working, and commit often to avoid merge conflicts.

## Installation

Daily Logging is not yet available in Community plugins. You can install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable **BRAT** from Community plugins.
2. In BRAT's settings, choose **Add beta plugin** and enter `normalsalt/obsidian-daily-logging`.
3. Enable **Daily Logging** in **Settings → Community plugins**.

BRAT keeps the plugin up to date with new releases.

## License

[MIT](LICENSE)

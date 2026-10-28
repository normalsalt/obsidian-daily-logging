# Daily Logging

Log what you work on to your daily note without thinking about it.

When you create a note, Daily Logging appends the time and a link to today's daily note. A task list in the sidebar shows today's recurring and scheduled tasks, and lets you log when you start, interrupt, and end each one.

```markdown
## Morning routine
---
- 06:12 [[Stretching]] started
- 06:30 [[Stretching]] ended (00:18)

## Main work
---
- 13:05 [[Fix login bug]]
- 13:40 [[Weekly report]] started
- 14:10 [[Weekly report]] interrupted (00:30)
```

## Requirements

- Obsidian 1.13.2 or later
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
- It is scheduled for today or an earlier day. Overdue tasks stay in the list until you end them.
- It repeats today and hasn't been ended today.

A task scheduled for a later day is hidden until that day, even if it repeats today.

| Action    | What it does                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------- |
| Start     | Sets `started` and logs it. Works on any Markdown file, even one without properties.               |
| End       | Sets `ended` and logs it with the time spent. Clears `scheduled`.                                  |
| Interrupt | Sets `ended` and logs it with the time spent. Sets `scheduled` to 15 minutes later, so the task stays in the list. |

The **Start task**, **End task**, and **Interrupt task** commands work on the file that is currently open. You can assign hotkeys to them.

After you start, interrupt, or end a task, the daily note opens in a new tab, with the cursor on the new line. If the daily note is already open, its tab is shown instead. You can turn this off with **Show the logged line** in the settings.

## Calendar events

Daily Logging can turn your Google Calendar events into tasks. It fetches the events from a Google Apps Script web app that you deploy yourself. The web app takes `token` and `until` (a time of the next day, as `HH:mm`) and returns the events that start from now until that time.

In the **Calendar** settings, enter the web app's URL and choose the secret that holds its token. The token is kept in Obsidian's secret storage, not in the plugin's settings file.

Events are fetched every day, a set number of minutes before the start of the day (default: 15), while the vault is open. If the vault isn't open at that time, they aren't fetched that day. You can also fetch them at any time with the **Fetch calendar events** command.

For each event, a note named after the event is used at the top level of the vault. If it doesn't exist, it is created. Its `scheduled` and `location` properties are overwritten with the event's start and location each time. The event's description is added to the end of the note, unless the note already contains it.

If the start of the day is midnight, the scheduled fetch runs late the previous evening, and only the events of the next few minutes are fetched. Use the command instead in that case.

## Notes

- Daily Logging reads the settings of the Daily notes core plugin through an internal, undocumented API. A future Obsidian update may break it. If that happens, or if the Daily notes core plugin is disabled, Daily Logging shows a notice and a warning in the task list, and nothing is logged until it can use the plugin again.
- Other errors are also shown in a notice. Details appear in the developer console.
- Daily Logging connects to the network only to fetch calendar events from the web app URL you enter. Nothing is sent except the token and the time range.
- If you sync with Git and log on more than one device, the same daily note may be edited on each device. Pull before you start working, and commit often to avoid merge conflicts.

## Installation

Daily Logging is not yet available in Community plugins. You can install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable **BRAT** from Community plugins.
2. In BRAT's settings, choose **Add beta plugin** and enter `normalsalt/obsidian-daily-logging`.
3. Enable **Daily Logging** in **Settings → Community plugins**.

BRAT keeps the plugin up to date with new releases.

## License

[MIT](LICENSE)

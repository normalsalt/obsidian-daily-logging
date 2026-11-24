# Daily Logging

Log what you work on to your daily note without thinking about it.

When you create a note, Daily Logging appends the time and a link to today's daily note. A task list in the sidebar shows today's recurring and scheduled tasks, and lets you log when you start, interrupt, and end each one.

```markdown
## Morning routine
- 06:12 [[Stretching]] started
- 06:30 [[Stretching]] ended (00:18)
## Main work
- 13:05 [[Fix login bug]] created
- 13:40 [[Weekly report]] started
- 14:10 [[Weekly report]] interrupted (00:30)
```

## Requirements

- Obsidian 1.13.2 or later
- The **Daily notes** core plugin must be enabled. Daily Logging uses its folder, date format, and template. If today's daily note doesn't exist yet, it is created.

## Logging new files

A line is added when you create a file and open it within a few seconds on the same device. Files added by Git pull or by other tools aren't logged, because they are never opened. Daily notes themselves are never logged.

For a note created from a template with [Templater](https://github.com/SilentVoid13/Templater), the time is when the template has been applied, so you can take your time answering its prompts.

The word after the link (default: `created`) can be changed with **Create label** in the settings.

- **File extensions**: Only files with these extensions are logged (default: `md`).
- **Time slots**: Each entry is added under the heading of its time slot. If the heading doesn't exist yet, it is created. Each slot is written on one line as `time | heading | tag`.
- **End of the day**: When the last time slot ends. The task list shows the time left in the current time slot, and for the last slot it counts down to this time. If it is empty, it counts down to the first time slot of the next day.
- **Early entries**: Entries before the first time slot go to the previous day's daily note, under the last slot. In the task list, this time is also used as the start of the day.

Under each entry, an empty bullet indented one level is added, so you can write a note about it. You can turn this off with **Add a bullet under each entry** in the settings. If the lines just above a new entry are empty list items, such as `- ` with nothing after it, they are removed.

## Opening daily notes

When you open a daily note, the cursor moves to the end of the note, so you can start writing right away. If the note ends with an empty bullet, the cursor goes to that bullet. It doesn't move when you only switch tabs, or when a link to a heading or block opened the note. You can turn this off with **Move the cursor to the end of daily notes** in the settings.

Daily notes open in the right pane, and other notes open in the left pane, whether you open them from a link, the file explorer, the quick switcher, or the task list. If there is only one pane, opening a daily note splits it. If that pane has only daily notes, opening another note splits it too, with the new note on the left. If the pane already exists, a new tab is added to it, so the editor is never split into more than two panes. If the note is already open in that pane, its tab is shown instead. If the note is already open in the other pane, that tab is closed. Tabs you have already opened are never moved. You can turn this off with **Open daily notes on the right** in the settings.

## Task list

Open the list from the ribbon or with the **Open task list** command. Any Markdown file with one of the following properties is treated as a task. You can change the property names in the settings.

| Property    | Type        | Meaning                                                        |
| ----------- | ----------- | -------------------------------------------------------------- |
| `repeat`    | List        | Days the task appears: `Every day`, `Workday`, `Holiday`, or weekdays such as `Monday` |
| `section`   | Text        | Tag of the time slot to group the task under                   |
| `tags`      | List        | Tasks with the same first tag are grouped together within a time slot |
| `scheduled` | Date & time | Show the task on this day                                      |
| `time`      | Text        | Time of day, such as `18:00`. Used like the time of `scheduled` when `scheduled` is empty |
| `skipped`   | Date & time | Set by the plugin when you skip the task. Hides the task from the list on this day, unless it is running. Cleared when you start the task or mark it as already done |
| `estimate`  | Number      | Estimated time in minutes. The task's row in the list is taller by half its height for every 60 minutes, such as 1.5 times for `60`. The name wraps onto one more line for every 60 minutes, such as 2 lines for `60` |
| `started`   | Date & time | Set by the plugin when you start the task                      |
| `ended`     | Date & time | Set by the plugin when you end or interrupt the task           |

A task is shown when one of the following applies:

- It is running.
- It is scheduled for today or an earlier day. Overdue tasks stay in the list until you end them, in the **Other** group regardless of their section.
- It repeats today and hasn't been ended today.

A task scheduled for a later day is hidden until that day, even if it repeats today.

A task whose `skipped` date is today is hidden for the day, before any of the rules above apply, unless it is running. Instead, it is shown in the **Skipped** group, below the running tasks. This group is collapsed until you click its heading, and is collapsed again when you restart Obsidian. You can change its name with **Skipped group name** in the settings.

Within each time slot, two or more tasks with the same first tag are shown together under the tag's name.

Click the heading of a group to collapse or expand it. The heading shows the number of tasks in the group. A collapsed group stays collapsed until you expand it. The headings of the running tasks and the current time slot are shown in the accent color. The button at the top of the list collapses every group except the running tasks and the current time slot. When they are already collapsed, it expands all groups except the **Skipped** group. To collapse the current time slot too, turn off **Keep the current time slot open** in the settings.

The buttons at the top of the task list open daily notes. The middle one opens today's daily note, and creates it if it doesn't exist yet. The left and right ones open the closest existing daily note before or after the one you have open, even if some days are missing. If you don't have a daily note open, they start from today.

Running tasks and the tasks in the current time slot are highlighted. A running task shows the time since it started, in place of its scheduled time.

If a task's note has unchecked checkboxes under the **Title heading** (default: `Tasks`), the list shows the first one instead of the file name, even if it is nested under another item. Links and formatting such as bold are shown as plain text. Bullets with only a weekday work the same way as in the steps (see below), so the name can change by the day:

```markdown
## Tasks
- Monday
	- [ ] Take out the burnable trash
- Thursday
	- [ ] Take out the recyclables
- [ ] Take out the trash
```

To use `Workday` and `Holiday`, enter the name of a note in **Holiday note** in the settings. If the `scheduled` date of that note is today, today is a holiday. Otherwise, it is a workday. If you add an all-day event with that name to your calendar, its date is set when events are fetched (see [Calendar events](#calendar-events)). The holiday note itself isn't shown in the task list.

| Action    | What it does                                                                                       |
| --------- | -------------------------------------------------------------------------------------------------- |
| Start     | Sets `started` and logs it. Works on any Markdown file, even one without properties.               |
| End       | Sets `ended` and logs it with the time spent. Clears `scheduled`.                                  |
| Interrupt | Sets `ended` and logs it with the time spent. Sets `scheduled` to 15 minutes later, so the task stays in the list. |
| Skip      | Right-click the task in the list (long-press on mobile) and choose **Skip**. Sets `skipped`, clears `scheduled` like End, and logs it, so you can write the reason under it. The task is hidden until the next day. |

If you forgot to press a button, right-click the task in the list (long-press on mobile), or use a command on the open note. The times you don't know are written as `??:??`.

| Menu item       | Command                   | When        | Entry                                  |
| --------------- | ------------------------- | ----------- | -------------------------------------- |
| Forgot to start | Forgot to start task      | Not running | `- ??:?? [[Task]] started`. The task is running from an unknown time, and ending it later logs `(??:??)` as the time spent. |
| Forgot to end   | Forgot to end task        | Running     | `- ??:?? [[Task]] ended (??:??)`       |
| Already done    | Mark task as already done | Not running | `- ??:?? [[Task]] done (??:??)`. Clears `scheduled`, like End. |

When you start a task, the unchecked checkboxes under the **Steps heading** of the task's note (default: `Steps`) are copied under the entry, with the lines nested under them, and the cursor goes to the first one. They take the place of the empty bullet. Checked and other items are skipped, with their nested lines. To have different steps on different days, write a bullet with only a weekday from your **repeat** values, such as `- Tuesday`, and put the steps under it. Separate weekdays with commas, such as `- Monday, Thursday`. You can also use your Workday and Holiday values, such as `- Workday`. Like `repeat`, they follow the **Holiday note**. On that day, its steps are copied along with the steps that aren't under a weekday, in order from the top. Steps under other weekdays are skipped. Weekday bullets work at any level, even under another item or a step.

```markdown
## Steps
- [ ] Drink water
- Tuesday
	- [ ] Take out the trash
- Sunday
	- [ ] Water the plants
```

If there are no unchecked steps for the day, the first unchecked checkbox under the **Title heading** is copied the same way instead, with the lines nested under it. This is the one shown as the task's name in the list.

If the `location` property of a task has a URL or an internal link, it is shown in a popup when you start the task, so you can open it right away. The popup also has a button to open the task's note. Press Enter to open the first link, or Esc to close the popup. You can turn this off with **Show links when a task starts** in the settings.

If you skip a task without `repeat` days, a popup tells you that it won't appear in the list again until you set `scheduled`, with a button to open the task's note.

When you go to bed, press the start button of the bedtime row at the end of the task list. It is never placed among the running or skipped tasks. After you confirm, every task in the list is skipped from top to bottom (a running task is ended first), and the row's name is logged with the start label, such as `- 23:30 Bedtime started`, without a bullet under it. You can change the name with **Bedtime name** in the settings (default: `Bedtime`). Clicking elsewhere on the row does nothing. Popups for tasks without `repeat` days aren't shown. You can also go to bed with the **Go to bed** command, even when the task list isn't open.

Each button shows an icon and its label. You can choose the icons in the **Buttons** settings, by the name of a built-in icon such as `play`. To show only the icons, turn off **Show text on buttons**. A button without an icon always shows its label.

The **Start task**, **End task**, **Interrupt task**, and **Skip task** commands work on the file that is currently open. You can assign hotkeys to them.

To log something that isn't in the list, such as a phone call, press the lightning button at the top of the task list, or use the **Log an interruption** command. Enter a name and press Enter. Every running task is interrupted, and the name is logged with the start label, such as `- 14:05 Phone call started`. The name is written as you typed it, so type `[[ ]]` around it if you want a link. The interruption itself isn't tracked as a running task.

After you start, interrupt, end, or skip a task, the daily note opens in a new tab, with the cursor on the bullet under the new line (or on the new line, if the bullet is turned off). If the daily note is already open, its tab is shown instead. You can turn this off with **Show the logged line** in the settings. To skip a task without logging it, turn off **Log skipped tasks**.

## Calendar events

Daily Logging can turn your Google Calendar events into tasks. It fetches the events from a Google Apps Script web app that you deploy yourself. The web app takes `token` and `until` (a time of the next day, as `HH:mm`) and returns the events that start from now until that time.

In the **Calendar** settings, enter the web app's URL and choose the secret that holds its token. The token is kept in Obsidian's secret storage, not in the plugin's settings file.

Fetch events with the **Fetch calendar events** command, or with the refresh button at the top of the task list.

For each event, a note named after the event is used at the top level of the vault. If it doesn't exist, it is created. Its `scheduled` and `location` properties are overwritten with the event's start and location each time. The event's description is added to the end of the section under the **Title heading** (default: `Tasks`), unless the note already contains it. The description goes on the line right after the last line of the section, without a blank line, and above any blank lines at the end of the section. If the note doesn't have the heading, it is added to the end of the note as a level 2 heading, such as `## Tasks`, with the description under it. Every two spaces at the start of a line become a tab. For an all-day event that started on an earlier day, `scheduled` is set to today.

## Command line

With the [Obsidian CLI](https://help.obsidian.md/cli), you can list and log tasks from a terminal, or let an AI agent such as Claude Code do it. Obsidian must be running. Run `obsidian help` to see the commands and their options.

| Command                        | What it does                                                                 |
| ------------------------------ | ---------------------------------------------------------------------------- |
| `daily-logging:tasks`          | Lists today's tasks in the same order as the task list. Add `format=json` for JSON |
| `daily-logging:unstarted`      | Lists notes at the top level of the vault that have `repeat` or `scheduled`, even with no value, and have never been started (`started` is empty). Add `format=json` for JSON |
| `daily-logging:start`          | Starts a task                                                                |
| `daily-logging:end`            | Ends a running task                                                          |
| `daily-logging:interrupt`      | Interrupts a running task                                                    |
| `daily-logging:skip`           | Skips a task for today                                                       |
| `daily-logging:forgot-start`   | Same as **Forgot to start**                                                  |
| `daily-logging:forgot-end`     | Same as **Forgot to end**                                                    |
| `daily-logging:done`           | Same as **Already done**                                                     |
| `daily-logging:schedule`       | Sets `scheduled` with `at=`, such as `at="2026-12-01 14:00"`, `at=2026-12-01`, or `at=14:00` for today. Add `clear` instead to clear it. Nothing is logged. A task skipped today shows up again when you schedule it for today |
| `daily-logging:create`         | Creates a task note at the top level of the vault. Add `repeat=` for a repeating task, or `at=` for a one-time task. See below |
| `daily-logging:interruption`   | Logs an interruption, such as `name="Phone call"`                            |
| `daily-logging:bedtime`        | Shows how many tasks would be skipped. Add `confirm` to go to bed            |
| `daily-logging:fetch-calendar` | Fetches calendar events                                                      |

Choose the task with `file=<name>` (found like a link) or `path=<path>`. Without them, the file that is open is used. For example:

```sh
obsidian daily-logging:tasks
obsidian daily-logging:start file="Weekly report"
```

To create a task, give its name and either `repeat=` or `at=`. The values of `repeat=` are the ones in your settings, separated by commas, such as `repeat="Monday, Thursday"`. You can also add `section=` (a tag of a time slot), `time=`, `tag=`, `estimate=`, `location=`, and `title=`, which is added as a checkbox under the **Title heading**. Only the properties you give are written. If a note with the same name already exists, nothing is created. Creating a task isn't logged.

```sh
obsidian daily-logging:create name="Take out the trash" repeat=Wednesday section=Night time=21:30
obsidian daily-logging:create name="Dentist" at="2026-12-01 15:00"
```

The commands don't change what Obsidian shows. The daily note isn't opened and no popups are shown. Instead, the logged line is printed, with the links in `location` when a task starts, and a note when a task without `repeat` days is skipped.

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

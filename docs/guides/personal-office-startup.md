# Personal office: start, stop, and backup

## Windows one-click entry points

Open the project folder in File Explorer and double-click `Start-Office.cmd`. It starts this local office and opens the Japanese interface. Leave its console window open while using the office. Double-click `Stop-Office.cmd` to stop the office started by this launcher, or press Ctrl+C in its console. Closing only the browser tab does not stop the server.

For convenient access, create a Windows shortcut to `Start-Office.cmd` and place it on the desktop or pin it where desired. The launcher does not install software, change PowerShell execution policy, or terminate unrelated applications. If Node or project dependencies are missing, follow the displayed error; this checkout already has dependencies installed.

If port 5173 is occupied by a server started manually, stop that server in its original terminal with Ctrl+C before using the launcher. The stop launcher cannot stop an unrelated/manual server. A second start of the same launcher reuses its running office.

## Manual startup (existing method)

1. Open this project folder in File Explorer.
2. Open PowerShell in that folder.
3. Run `node node_modules/vite/bin/vite.js --host 127.0.0.1`.
4. Open `http://127.0.0.1:5173/?lang=ja` in a browser.
5. To stop, return to that PowerShell window and press Ctrl+C.

Keep the displayed Local URL: Vite may choose another port if the manual command encounters an occupied port. The one-click launcher uses a strict port and reports the conflict instead.

## What the dashboard controls

The central office shows the original white four-room design and block characters. The header summarizes received AI status; animation alone does not mean an AI is working. The left rail contains local projects and the staff list. The right rail contains manual project notes, a plan, checklist tasks, and received work status. Editing a plan or checking a task does not run an AI command.

Project data is stored in the current browser on this local origin. Different browsers, profiles, ports, or cleared site data use different storage. Export project JSON periodically using the dashboard backup action. Save the downloaded file somewhere you keep backups. A visible storage error means changes might only exist in memory: export before closing the page. Office preferences use their existing separate storage.

## Change history and restoration

`9a0daa1` is the Japanese localization baseline. `37017c0` adds the white four-room layout and block characters. Subsequent dashboard/launcher work is saved in a separate commit. Use Git revert of the specific change to undo code while preserving history; avoid hard reset or cleaning untracked files. Browser project data is separate from Git, so export it before clearing or replacing browser storage.

The original KbWen copyright and MIT license remain in `LICENSE` and package metadata. Custom characters use original SVG geometry and no Roblox assets.

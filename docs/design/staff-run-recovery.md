# Staff run recovery

Keep the existing form and styling. Below the start button show an accessible status explaining the first blocking condition: project, saved category, AI permission, request, Astra reason, submission, run lookup, active run, unavailable lookup.
Whenever a run ID exists, show the display-reset button below errors, including during lookup and active execution. Explain that reset does not cancel execution or delete artifacts; the server retains its single-active-run guard. Disable reset only during submission. Initial and periodic lookups time out after ten seconds. Missing records and terminal runs can be cleared; unavailable records require explicit reset before starting again. Project-key remount isolates persisted IDs and late responses.

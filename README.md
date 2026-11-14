# FregApp notices

Generic notification engine and calendar helpers only. No app, household data or credentials are stored in this repository.

Standard public GitHub Actions runners execute the engine directly. No AI Studio or Cloud Run endpoint is required. The dedicated technical service account has database access only in the separate FregApp project and can read its billing status. It cannot administer Auth, deploy the app or activate billing. Access covers the database, not individual collections.

The workflow remains off while `FREGAPP_FREE_DELIVERY_APPROVED` is `0`. Live execution requires `1`, the main branch, all configured secrets and a successful check that billing is disabled. Never enable billing to resolve a failed check.

GitHub Secrets: `FIREBASE_SERVICE_ACCOUNT`, `FREGAPP_HOUSEHOLD_ID`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. Never paste their values into issues, code or logs. Do not enable secrets in pull request workflows. Existing HTTP URL/HMAC secrets are not used by this workflow.

Schedule: 09:00 Europe/Madrid and hourly at minute 17. Reviews close after at least 72 hours, normally within the following hourly run. GitHub can delay or omit scheduled runs and suspends public schedules after 60 days without repository activity. No guarantee of exact delivery time; do not generate artificial activity.

Stopping: set the activation variable to `0` to skip future jobs and cancel any running job. The database lease and time guards prevent an expired worker from continuing side effects. Notifications already delivered cannot be recalled.

Receiving on iPhone requires installing the PWA from its current URL, signing in and explicitly allowing notifications. Closing the app preserves subscriptions; logging out disables that installation.

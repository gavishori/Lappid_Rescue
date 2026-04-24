FLYMILY mobile hardened build - 2026-04-24

Included files:
- index.html
- style.css
- firebase.js
- app.js
- mobile-auth.css
- mobile-auth.js

Fix pass implemented in the requested order:
1. Instant login after browser/password-manager/Face-ID completes valid email + password fields, without requiring another confirmation tap.
2. Hard mobile no-horizontal-overflow layer: html/body/app/container/tabs/cards/tables/modals clamp to viewport width and use vertical scrolling only where needed.
3. Mobile modal frames are fixed first for trip/expense/journal dialogs, then the internal controls are laid out inside the fixed frame.
4. Repaired expand all / collapse all and sort controls with capture-phase handlers and post-render re-application.

Validation performed:
- JavaScript syntax validated with node --check app.js.
- Final CSS and JS overrides are appended at the end of the files so they win over older duplicate rules.

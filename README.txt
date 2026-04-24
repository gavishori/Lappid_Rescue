FLYMILY mobile hard-lock build v3

Included files:
- index.html
- style.css
- firebase.js
- app.js
- mobile-auth.css
- mobile-auth.js

Main fixes:
1. Instant login after password-manager / Face ID autofill when email and password are valid.
2. Hard mobile no-horizontal-overflow guard using CSS + runtime visualViewport width lock.
3. Mobile dialogs are now frame-locked first: fixed bottom sheet width = visual viewport - 16px, no horizontal overflow, inner body scrolls vertically only.
4. Expense / journal modal controls are rebuilt inside the fixed frame with compact mobile grids and icon-sized location/currency controls.
5. Expense and journal row colors are preserved on mobile according to the desktop semantics: expense amber, journal blue.
6. Expand/collapse all and sort controls for overview, expenses and journal are rewired with a delegated capture handler.

Validation:
- app.js syntax checked with node --check.

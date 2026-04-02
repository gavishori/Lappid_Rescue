FLYMILY clean build

Included files:
- index.html
- style.css
- firebase.js
- app.js

Changes in this clean build:
- Removed previous-version helper files from the package.
- Switched the app entry point to a single app.js file.
- Exposed invalidateMap globally to fix window.invalidateMap runtime errors.
- Added safe title fallbacks for expenses and journal rows so user-entered titles do not disappear.
- Added clean overview desktop layout overrides so expense and journal rows render with consistent width and field order.


Deep cleanup in this package:
- Removed duplicate mobile compact CSS block.
- Removed redundant share-duration event wiring.
- Removed duplicate ensureExpenseCurrencyOption implementation.
- Fixed RTL/LTR bidi rendering for date, time, amount, and currency cells.
- Removed duplicate HTML id usage for logout buttons.
- Preserved module entry structure: index.html -> firebase.js -> app.js.
- JS syntax validated with node --check.

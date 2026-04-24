FLYMILY mobile-fit build

Included files:
- index.html
- style.css
- firebase.js
- app.js
- mobile-auth.css
- mobile-auth.js

Mobile adaptation performed:
- Added a final mobile override layer at the end of style.css so it wins over earlier duplicated rules.
- Locked the outer frame to the viewport and blocked horizontal overflow at html/body/app/container/content/tab/dialog/table levels.
- Rebuilt mobile navigation into compact icon tabs to save width.
- Converted list/table areas into mobile card-style layouts with wrapping text and clamped menus.
- Reworked trip list, meta screen, budget, expenses, journal, map, share/import/export, and modal layouts for narrow screens.
- Replaced wide action labels with compact icon actions where screen width is limited.
- Preserved vertical scrolling only inside content areas or modal bodies when text is long.
- Added a small mobile viewport hardening script in app.js that clamps dynamically rendered wide elements after renders/resizes.

Validation:
- app.js syntax checked with: node --check app.js
- CSS brace balance checked after patching.

Notes:
- No Firebase configuration or business logic was changed.
- The unused previous-version file "style - Copy.css" was not included in this clean package.

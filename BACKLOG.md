# Product Backlog

## Future Features
- [ ] **"Twits" / Live Commentary:**
      - Allow players to post short text messages (140 chars) to the TV.
      - Display a scrolling "News Ticker" at the bottom of the scoreboard.
- [ ] - Add more themes and customization,
- [ ] - convert all dialogs to modal overlays to get common look/feel.

## Security & Accounts
- [ ] **Host Accounts:** Implement User ID/Password so random people cannot admin games they didn't create.

## Infrastructure
- [ ] **Cloud Storage:** Move image storage to AWS S3 / DigitalOcean Spaces (Required for multi-server scaling).
- [ ] **Short Room Codes:** Map 4-letter codes (e.g., "TREX") to long Game IDs in Redis for easier TV entry.

## Completed Items
- [x] **Smart Onboarding & Game Creation:**
      - Split "Host New Game" vs "Reconnect" flows.
      - Implemented sanitization (removing spaces/emojis) for Game IDs.
      - Added "Smart Search" to find existing games by partial name.
- [x] **Settings UI Overhaul:**
      - Replaced ugly stack layout with a clean CSS Grid.
      - Added Help Tooltips (i) for clarity.
      - Added "Game Defaults" wizard that auto-launches for new games.
- [x] **Support Randomizing Players:**
      - Added "Roster Mode" toggle in settings.
      - Admin can paste a list of names (one per line).
      - Server performs a Fisher-Yates shuffle to assign random turn numbers.
      - Added "Smart Sync" so typing a number auto-generates "Player X" placeholders.
- [x] **TV Scoreboard Enhancements:**
      - Added "On Deck" indicator to the active player banner.
      - Implemented "Rules" overlay for the big screen.
- [x] **Player Management (In-Game):**
      - Add a "Delete" button for players who leave early.
      - Add a "Skip Turn" button for players currently in the bathroom.
      - Logic to handle "Late Arrivals" (Insert them into the random pool for upcoming turns).
- [x] **Sandbagging Prevention:**
      - Instead of a fixed order (1..N), randomly choose the *next* player from the pool of remaining players. (Prevents the last person from knowing they have the power position).

# Product Backlog

## Future Features
- [ ] **The "Worst Gift" Safety Net**
    - **Context:** Some guests bring low-effort gifts (e.g., cigarettes/beer) which ruins the mood.
    - **Mechanic:** Host provides "Spare Gifts."
    - **Phase:** Post-Game (after all turns).
    - **Interaction:**
        1. Admin triggers "Vote Mode."
        2. Mobile users tap the gift they think is the "Worst."
        3. Top 2 vote-getters are flagged.
        4. Holders of those gifts get to swap for a "Spare Gift" provided by the host.
- [ ] FAQ, Best Practices, Tips page

## Infrastructure
- [ ] Move image storage to AWS S3 / DigitalOcean Spaces (Required for multi-server scaling).
- [ ] Implement 4-letter Room Codes (e.g., "TREX") instead of long IDs.
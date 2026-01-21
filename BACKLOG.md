# Product Backlog

## Future Features
- [ ] Support Randomizing Players.
    - Assume players are assigned continuos numbers starting with 1.  Allow
      Gamekeeper to enter count on setup.  
      Randomly draw numbers to keep suspense.
    - Support Game Admin writing names in before game.  
      Randomly draw names to keep suspense.
- [ ] Add an "On Deck" to Scoreboard
- [ ] Support changes to players during game.
      - Add delete button in case a player left early 
      - consider adding a skip button for player who's in the bathroom
      - support increasing number, or adding a player by name who came late.
          randomize them within the remaining players.
      - instead of generating a random order from the start.  
        Randomly chose (next) from remaining players for each "turn".
- [ ] consider supporting  Twits... Tweets within the game.  
      - people adding character limited (140?) comments to a gift in addition to pics.
      - perhaps a scrolling ticker tape at bottom of scoreboard with twits... 


## Infrastructure
- [ ] Move image storage to AWS S3 / DigitalOcean Spaces (Required for multi-server scaling).
- [ ] Implement 4-letter Room Codes (e.g., "TREX") instead of long IDs.
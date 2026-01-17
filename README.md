# 🐘 Elephant Exchange
**A Real-time White Elephant Gift Exchange Manager**

Copyright (c) 2026 Jim Willey. Licensed under the MIT License.

## Overview
Elephant Exchange is a modern, real-time web application designed to manage the chaos of a "White Elephant" or "Yankee Swap" gift exchange. Built for large groups (Scouts, Office Parties, Family Reunions), it handles the complex rules of turn management, gift stealing, and "No Take-Back" enforcement so the host can focus on the fun.

## Features
* **Real-Time Sync:** Using Socket.io, the dashboard updates instantly on all connected devices (Projector + Admin Laptop).
* **Smart Turn Management:** Automatically tracks whose turn it is, handling the "Steal Interrupt" logic where a victim immediately becomes the active player.
* **Rule Enforcement:**
    * Tracks "Steal Counts" per gift (locks after 3 steals).
    * Enforces "No Take-Backs" (prevents immediate re-stealing).
* **Dynamic Gift Creation:** Gifts are added to the system as they are opened, speeding up gameplay.
* **Admin Tools:** Edit gift descriptions on the fly (e.g., when a "Mystery Box" is revealed to be a Blender).

## Tech Stack
* **Backend:** Node.js, Express
* **Database:** Redis (for speed and simple state management)
* **Real-time:** Socket.io
* **Frontend:** Vanilla JS / HTML5 (No build step required)
* **Infrastructure:** Docker & Docker Compose

## Quick Start

### Prerequisites
* Docker & Docker Compose

### Running the App
1.  Clone the repository:
    ```bash
    git clone [https://github.com/j2willey/Elephant-Exchange.git](https://github.com/j2willey/Elephant-Exchange.git)
    cd Elephant-Exchange
    ```

2.  Start the containers:
    ```bash
    docker compose up -d
    ```

3.  Open your browser:
    * Go to `http://localhost:3000`

### How to Play
1.  Enter a **Game ID** (e.g., `troop-55`) to start a room.
2.  Add **Participants** (Names and/or Numbers).
3.  The highlighted **Active Player** can:
    * **Open New:** Creates a new gift entry.
    * **Steal:** Selects a gift from the history (if allowed).
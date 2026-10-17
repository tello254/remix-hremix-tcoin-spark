# Remix HRemix Tcoin Spark

Build a social video rewards platform called Tcoins with a theme of electric purple, neon green, and radiant yellow, featuring 3D-looking Tcoins and rich animations. Focus on delivering a polished, interactive frontend and complete UI first (with mock state/simulation so it can be previewed, tested, and remixed before connecting a database).

Key features and specifications:
1. Visual Design & Gamification:
   - Deep electric purple background with neon green action accents and golden yellow highlights.
   - 3D-looking metallic Tcoins with reflections, floating/rotation animations, and coin celebration particle bursts on task completion.
   - Fixed conversion rate: 10 Tcoins = 1 KSH (Kenyan Shilling).

2. User Onboarding & Account:
   - User sign-up / profile setup where earners register their phone number and their social media handles (YouTube, TikTok, and Instagram) so their comments can be tracked.
   - Account tiers: Free tier (gets 2-3 randomized tasks daily) with options to upgrade to Pro tier (5-10 daily tasks across multiple accounts).

3. Daily Task Feed & Anti-Cheat Verification:
   - Randomized daily tasks distributed across 3 creator channels (2 YouTube, 1 TikTok) with thumbnails, links, reward (20 Tcoins / 2 KSH per video), and live remaining slot meters (e.g. '382 / 500 completed').
   - Task completion loop: User clicks the task card to open the video, a 45-second on-site countdown timer starts, user likes the video and leaves a natural comment of at least 3 words.
   - Verification: User submits task completion, the system simulates/verifies their registered social handle and checks for a 3+ word comment, then instantly credits 20 Tcoins to their wallet with celebratory animations.

4. 100% Instant Cashout & Wallet:
   - Minimum withdrawal threshold: 50 Tcoins (5 KSH).
   - Cashout drawer allowing the user to select between M-Pesa Cash or Airtime (Safaricom/Airtel), enter the amount, and confirm the phone number.
   - 100% instant withdrawal flow: shows instant processing state and transaction receipt code, ready for Daraja B2C / Airtime API integration.

5. 1-Level Referral System:
   - Unique referral link generator.
   - Direct 1-level downline tracking (earns 1 Tcoin for every task completed by direct referrals, no multi-level complexity).

6. Creator Admin Portal:
   - Campaign manager: launch video campaigns with video URL, platform (YouTube/TikTok/Instagram), thumbnail, total budget in KSH, payout per task (e.g. 2 KSH), and auto-calculated completion slots (e.g. 500 comments).
   - Hard budget cap: real-time meter that automatically marks campaigns as completed and closes them when the budget/slots are exhausted.
   - Live activity ledger: view completed tasks, user handles, and real-time withdrawal records.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/5a632711-adbb-4198-9be6-b598dc07e787).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

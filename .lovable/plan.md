# Tcoins: rewards engine, tiers, referrals and cleanup

Everything stays a preview with simulated balances (no real M-Pesa charges or payouts yet).

## 1. Navigation and home cleanup
- Remove "Creator studio" from the sidebar and mobile bar. The /creator page stays reachable only by direct link (hidden admin entry), not from any menu.
- Home: remove the "Recent activity" list and the "Good things are better shared" referral card. Home keeps the daily goal, streak, Pro banner and video tasks.
- Add a one-time welcome banner: "You got 25 Tcoins to start" plus a progress meter "X/5 videos towards today's batch".

## 2. Daily reset at 00:00 UTC
- Replace "Resets at midnight EAT" with a live countdown to 00:00 UTC (03:00 Nairobi).
- Note on the task board: tasks not finished by 00:00 UTC are pulled; nothing carries over; a fresh set appears daily.
- In the preview, a day rollover clears the done list and any task in progress.

## 3. Wallet as the only activity history
- Full ledger with source tags: Task, Referral, Welcome bonus, Badge purchase, M-Pesa withdrawal.
- Withdrawal threshold card: first withdrawal 50 Tcoins (free transfer promo); after it, permanently 300 Tcoins.
- Referral Tcoins are only withdrawable after you finish your own daily quota that day; the card shows "locked referral" vs "withdrawable" amounts.
- Payout phone must match the account phone.

## 4. Referrals page
- Top banner with the rules: 25 Tcoins on friend's first video + 25 on their first withdrawal (50 per person); ongoing reward per task; direct referrals only (1 level); cashout gating by your own daily quota.
- Pipeline table per friend: Registered (0) -> First video reviewed (+25) -> First cashout done (+25) -> Daily active (ongoing).
- Free-tier cap counter: "1/2 referral activations credited today. Upgrade to Pro for unlimited." Pro and Premium lift the cap.
- Simulate buttons to push a demo friend through each stage.
- Toast when your own first review pays your upline: "Your upline received 25 Tcoins for your first review!"

## 5. Free / Pro / Premium tiers
- Free: 3 daily tasks. Pro: KSH 150 or 1,500 Tcoins, or auto-unlock at 16 lifetime tasks. Premium: KSH 350 or 3,500 Tcoins, or auto-unlock at 40 lifetime tasks.
- Badge modal shows all three, progress toward each unlock, and "Pay with M-Pesa" (simulated) / "Pay with Tcoins" (deducts balance, logged in the wallet).
- Copy: "Earn it through consistent hustle, or activate it now."
- Account page shows current tier and lifetime task count.

## Decisions to confirm (defaults used unless you change them)
- Ongoing referral reward: **2 Tcoins per task** your friend completes (your rules list), not the +6 per finished batch from the table.
- Daily task counts: Free 3, Pro 5, Premium 8 per day. The "5 videos" batch meter uses the user's actual daily limit.
- Social handles already used by another account are rejected (shown as a check message in the preview only).

## Technical details
- `src/lib/rewards.ts`: add WELCOME_BONUS, FIRST_WITHDRAWAL_MIN=50, REGULAR_WITHDRAWAL_MIN=300, UPLINE_REWARD_FIRST_TASK/FIRST_WITHDRAW=25, REFERRAL_TASK_REWARD=2, FREE_DAILY_REFERRAL_CAP=2, TIERS config (price KSH, price Tcoins, unlock tasks, daily limit), `nextUtcReset()`, `withdrawalMin(hasWithdrawn)`, `withdrawableBalance(...)`, and updated `validateCashout`.
- `state.tsx`: tier, lifetimeTasks, hasCompletedFirstWithdrawal, welcomeSeen, referral friends with stage, daily referral credits, entry kinds extended; actions buyTier, advanceReferral, rollDay.
- `app.tsx`: nav array without creator, home bottom grid removed, modal rebuilt, wallet/referrals views updated.
- Update AGENTS.md rule and save the reward numbers to project memory.

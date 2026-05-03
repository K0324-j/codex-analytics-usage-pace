# Codex Analytics Usage Pace

Chrome Manifest V3 extension for the Codex analytics screen.

## What it adds

- Reset countdown
- Used percent
- Elapsed-time percent
- Difference between used percent and elapsed-time percent
- Pace label
- Weekly-limit daily allowance estimate

## Target cards

- `5時間の使用制限`
- `週あたりの使用制限`

The content script ignores unrelated analytics cards such as credits, auto recharge, and code review.

## Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load unpacked extension.
4. Select this project folder.

## Notes

The script waits for React-rendered DOM changes with `MutationObserver` and avoids duplicate UI by reusing one extension-owned element per target card.

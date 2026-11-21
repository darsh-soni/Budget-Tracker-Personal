# Apple Wallet → Pocket Ledger: Shortcuts automation

This is the exact configuration for the iOS **Transaction** automation that sends every Apple Pay tap to
`POST /api/transactions`. The same steps are shown inside the app under **Settings → Connect Apple Wallet**,
with your URL and key ready to copy.

> Requires iOS 17 or later (the *Transaction* trigger). Works for Apple Pay taps on the iPhone and paired
> Apple Watch. It does **not** see online purchases typed with a card number, physical card swipes/inserts, or
> pre-authorized bills. Use quick entry (＋) or CSV import for those.

## What you need

| Item | Where to find it |
|---|---|
| Endpoint URL | Settings → Connect Apple Wallet → **URL** (e.g. `https://your-app.vercel.app/api/transactions`) |
| API key | Same screen → **X-Api-Key** → Copy |

## Step-by-step

1. **Open Shortcuts → Automation tab.** Tap **＋** (top-right) or **New Automation**.
2. Scroll to the **Personal** section and tap **Transaction**.
3. **When I tap any of:**
   - **Card**: tap *Choose* and select each Wallet card you want tracked.
   - **Category**: leave as *Any Category*.
   - **Merchant**: leave as *Any Merchant*.
4. Select **Run Immediately**. Turn **Notify When Run** off. Tap **Next**.
5. Tap **New Blank Automation**.
6. Tap **Add Action**, search for **Get Contents of URL**, and add it.
7. Tap the blue **URL** placeholder and paste your endpoint URL.
8. Tap the **›** chevron on the action to show more options, then set:
   - **Method**: `POST`
   - **Headers** → **Add new header**
     - Key: `X-Api-Key`
     - Value: *(paste your API key)*
   - **Request Body**: `JSON`
9. Under the JSON body, tap **Add new field → Text** four times and fill them in:

   | Key | Value (variable) | How to insert it |
   |---|---|---|
   | `amount` | **Shortcut Input → Amount** | Tap the value field → choose *Shortcut Input* in the variable bar above the keyboard → tap the inserted *Shortcut Input* token → pick **Amount** |
   | `merchant` | **Shortcut Input → Merchant** | Same, pick **Merchant** |
   | `card` | **Shortcut Input → Card or Pass** | Same, pick **Card or Pass** |
   | `timestamp` | **Current Date** | Choose *Current Date* from the variable bar, tap it → **Date Format: ISO 8601** (turn on *Include ISO 8601 Time*) |

10. Tap **Done**. That's it.

### The finished action should read

```
Get contents of  https://your-app.vercel.app/api/transactions
  Method:   POST
  Headers:  X-Api-Key: 3f9c…a1b2
  Request Body: JSON
     amount     [Shortcut Input › Amount]
     merchant   [Shortcut Input › Merchant]
     card       [Shortcut Input › Card or Pass]
     timestamp  [Current Date (ISO 8601)]
```

### What gets sent

```http
POST /api/transactions HTTP/1.1
Content-Type: application/json
X-Api-Key: 3f9c…a1b2

{
  "amount": "$6.45",
  "merchant": "Starbucks",
  "card": "Amex Cobalt",
  "timestamp": "2026-11-21T09:15:02-05:00"
}
```

The server is lenient: `amount` may be `"6.45"`, `"$6.45"`, `"CA$6.45"` or a number; keys are case-insensitive
(`Amount` works); `timestamp` may be ISO 8601, the default Shortcuts long format (`Nov 21, 2026 at 9:15 AM`), or
omitted (server time is used). Optional `note` (string) is stored too.

### Responses

| Status | Meaning |
|---|---|
| `201` `{ "ok": true, "id": "…", "card_matched": true }` | Saved |
| `409` `{ "duplicate": true }` | Same amount + merchant + card already logged within 60 s; ignored |
| `401` | Missing or wrong `X-Api-Key` (did you regenerate the key?) |
| `422` | `amount` or `merchant` missing/unreadable (check the variables in step 9) |

Send `"test": true` in the body to validate the key and parsing without saving anything. The in-app
**Send test transaction** button does exactly this.

## Verifying it works

- In the app, **Settings → Connect Apple Wallet → Send test transaction** should show a green ✓.
- Make a real Apple Pay purchase. Within a few seconds, **Last transaction received** turns green and the
  purchase appears on the Cards tab.
- Want to test without buying anything? In Shortcuts, create a *regular* shortcut (not an automation) with the
  same **Get Contents of URL** action, but type literal values (`amount` = `1.00`, `merchant` = `Test`,
  `card` = your card name) and add a `test` field set to `true` (Boolean). Run it.

## Card names

Apple Wallet sends the card's display name (e.g. "Amex Cobalt", "TD Aeroplan Visa Infinite"). Pocket Ledger matches it
to your saved cards by, in order: a name you linked before → exact name → last 4 digits in the name → an
unambiguous partial match. Anything unmatched shows a **"New card from Wallet"** banner on the Cards tab. Link it
once and all past and future transactions from that name land on the right card.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Nothing arrives | Check the automation is enabled and set to **Run Immediately**. Open the automation and confirm the URL has no trailing spaces. |
| 401 | Re-copy the key. If you tapped *Regenerate key*, the old one stopped working. |
| 422 "amount is missing" | The `amount` field must be the **Amount** property of *Shortcut Input*, not the whole *Shortcut Input*. |
| Wrong date/time | Format *Current Date* as ISO 8601, or remove the `timestamp` field to use server time. |
| Duplicates | Expected protection: identical taps within 60 s are dropped. Add a genuine second purchase manually. |
| Automation asks before running | Older iOS versions don't offer *Run Immediately* for this trigger. Update iOS. |

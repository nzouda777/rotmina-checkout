# Tranzila Hosted Fields — Bug Report

**Terminal:** `fxprotmina`  
**SDK script:** `https://hf.tranzila.com/assets/js/thostedf.js`  
**Environment:** Production (`sandbox: false`), Next.js 14, deployed on Vercel  
**Browser:** Chrome 130+ (latest)

---

## Summary

After resolving the handshake token (thtk) flow per your team's guidance, two bugs in the Tranzila Hosted Fields SDK are preventing card payments from completing in modern browsers. Both errors originate inside Tranzila's own scripts (`hf_global.js`, `ops_gfields.js`, `genfield.php`) — our application code is not involved.

---

## Bug 1 — Invalid regex pattern in `genfield.php` (browser compatibility)

### Error

```
genfield.php?field_name=credit_card_number&instance_identifier=...:1
  Uncaught SyntaxError: Invalid regular expression: /[0-9 /]*/v:
  Invalid character in character class

genfield.php?field_name=expiry&instance_identifier=...:1
  Uncaught SyntaxError: Invalid regular expression: /[0-9 /]*/v:
  Invalid character in character class

genfield.php?field_name=cvv&instance_identifier=...:1
  Uncaught SyntaxError: Invalid regular expression: /[0-9 /]*/v:
  Invalid character in character class
```

### Cause

`genfield.php` renders a `pattern` attribute with value `[0-9 /]*` on the hosted field `<input>` elements. Chrome 123+ enables the Unicode Sets regex flag (`/v`) by default, which enforces stricter character class syntax. The `/` character inside a character class `[...]` is treated as an invalid character in this mode, throwing a `SyntaxError`.

### Impact

All three hosted field iframes (`credit_card_number`, `expiry`, `cvv`) fail to initialize their input validation. The fields render visually but field-level validation is broken in any Chromium-based browser version 123 or later.

### Fix (suggested)

Escape the forward slash in the pattern: change `[0-9 /]*` to `[0-9 \/]*`, or replace the raw `/` with its Unicode escape `/`.

---

## Bug 2 — `ccType.luhn is not a function` in `hf_global.js`

### Error

```
Uncaught TypeError: ccType.luhn is not a function
    at isCCNumberValid (hf_global.js?V=DC2505:188:59)
    at validateCCNumber (ops_gfields.js:140:10)
    at validateAndNotify (ops_gfields.js:79:15)
    at HTMLInputElement.<anonymous> (ops_gfields.js:258:4)
    at i.proxy (zepto.js:880:17)
```

### Cause

`hf_global.js` (version `DC2505`) calls `ccType.luhn(cardNumber)` inside `isCCNumberValid()`. The `ccType` object returned for the detected card brand does not expose a `.luhn` method — it is either `undefined` or the method was removed/renamed in a recent version of the card-type detection library bundled with the SDK.

### Impact

Every keystroke in the card number field throws a `TypeError`. Because Luhn validation fails with an uncaught exception (instead of returning `false`), the SDK marks the card number as invalid regardless of what the user enters. This causes `charge()` to return:

```json
{
  "error": "invalid_resource",
  "error_description": "One or more parameters were missing or invalid",
  "messages": [
    {
      "code": "credit_card_number_invalid",
      "message": "מספר כרטיס האשראי לא תקין",
      "param": "credit_card_number"
    }
  ]
}
```

**No card number — valid or not — can be accepted in the current SDK version on Chrome 130+.**

### Fix (suggested)

In `hf_global.js`, add a guard before calling `.luhn`:

```javascript
// Before:
if (!ccType.luhn(cardNumber)) { ... }

// After:
if (typeof ccType.luhn === 'function' && !ccType.luhn(cardNumber)) { ... }
```

Alternatively, update the card-type detection library to a version that exposes the `.luhn` method correctly.

---

## Reproduction Steps

1. Open the Tranzila Hosted Fields payment page in Chrome 123 or later.
2. Open DevTools → Console.
3. Observe the three `SyntaxError` entries from `genfield.php` on page load.
4. Type any digit in the card number field — observe `ccType.luhn is not a function`.
5. Complete the card form and submit — observe `credit_card_number_invalid` response from `charge()`.

The same flow works correctly in **Firefox** (which does not enable the `/v` regex flag by default).

---

## SDK Initialization (for reference)

```javascript
window.TzlaHostedFields.create({
  sandbox: false,
  terminal: 'fxprotmina',
  thtk: '<valid token>',
  fields: {
    credit_card_number: { selector: '#credit_card_number' },
    cvv:               { selector: '#cvv' },
    expiry:            { selector: '#expiry' },
  },
})
```

The handshake token (`thtk`) is generated fresh server-side per your team's guidance and the same token is passed to both `create()` and `charge()`. This part of the integration is working correctly — the errors described above are unrelated to thtk.

---

## Request

Please update `genfield.php` and `hf_global.js` (version `DC2505`) to fix the two issues above so that payments can be processed in modern Chromium-based browsers.

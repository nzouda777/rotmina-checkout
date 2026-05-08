# Response to Tranzila Support Regarding Error 10017 (Invalid Handshake Token)

## 1. THTK Generation Endpoint
We are using the Tranzila REST API v1 endpoint to generate the handshake token (THTK):
*   **URL:** `https://api.tranzila.com/v1/handshake/create`
*   **Method:** `GET`

## 2. Request Parameters
The following parameters are sent in the request query string (handled via our backend):

| Parameter | Description | Source |
| :--- | :--- | :--- |
| **supplier** | Tranzila Terminal Name | `process.env.TRANZILA_TERMINAL` |
| **TranzilaPW** | API Password (for the terminal) | `process.env.TRANZILA_TERMINAL_PASSWORD` |
| **sum** | Exact transaction amount | Calculated dynamically on server-side |
| **currency** | Numeric currency code | `1` (ILS) or `2` (USD) |

*Note: We currently use the DirectNG/v1 authentication method (`TranzilaPW` in the query string). We are not using App Key/Secret headers for this specific handshake call.*

## 3. Implementation Flow
We have refined our flow to ensure token validity:

*   **Fresh Generation:** The THTK is generated **fresh for every charge attempt**. 
*   **Server-Side Execution:** The request is made from our backend at the moment the user initiates the payment.
*   **No Caching:** We do not cache or reuse tokens across multiple attempts.
*   **Strict Amount Sync:** The `sum` used for the THTK is guaranteed to be identical to the `sum` used in the final `charge()` call.
*   **Zero-Delay Execution:** The token is generated immediately before the payment execution, preventing any expiration issues.

## 4. Observations
We previously pre-loaded the token on page load, which likely caused the **10017** error due to expiration or minor amount mismatches (rounding). Our new implementation generates it on-demand to resolve this.

**Clarification Request:**
Could you please confirm if the endpoint `https://api.tranzila.com/v1/handshake/create` using `TranzilaPW` is still the preferred method for SAQ A Hosted Fields, or if we should migrate this specific call to use the `X-tranzila-api-access-token` (App Key/Secret) header authentication?

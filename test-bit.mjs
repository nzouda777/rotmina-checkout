import 'dotenv/config';
import crypto from 'crypto';

const appKey = process.env.TRANZILA_APP_KEY;
const secret = process.env.TRANZILA_SECRET;
const terminal = process.env.TRANZILA_TERMINAL;

function makeNonce(length) {
    let result = '';
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

const time = Math.round(Date.now() / 1000);
const nonce = makeNonce(80);
const key = `${secret}${time}${nonce}`;
const accessToken = crypto.createHmac('sha256', key).update(appKey).digest('hex');

const params = {
    terminal_name: terminal,
    sum: 2.96,
    currency: "1",
    success_url: "https://rotmina-checkout.vercel.app/api/checkout/bit-callback/success",
    failure_url: "https://rotmina-checkout.vercel.app/api/checkout/bit-callback/failure",
    notify_url: "https://rotmina-checkout.vercel.app/api/checkout/bit-callback/notify",
};

const response = await fetch('https://api.tranzila.com/v1/transaction/bit/init', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-tranzila-api-app-key': appKey,
        'X-tranzila-api-request-time': String(time),
        'X-tranzila-api-nonce': nonce,
        'X-tranzila-api-access-token': accessToken,
    },
    body: JSON.stringify(params)
});

const text = await response.text();
console.log("STATUS:", response.status);
console.log("BODY:", text);
